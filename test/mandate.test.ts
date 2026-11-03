import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Channel3Client, DemoCatalog, normalizeProduct, type ProductHit } from "../src/channel3/client.js";
import { runMandate, queryFromGoal } from "../src/mandate/agent.js";
import { parseMandateText } from "../src/mandate/parse-mandate.js";
import type { LlmClient } from "../src/guardian/llm.js";
import type { Mandate } from "../src/types.js";

const mandate: Mandate = {
  id: "m1",
  goal: "a birthday gift for my mom up to $40",
  currency: "USD",
  maxPerPurchase: 40,
  maxMonthly: 100,
  allowedCategories: [],
};

const items: ProductHit[] = [
  { productId: "a", title: "Gift mug", price: 20, currency: "USD", inStock: true, merchant: "shop.example" },
  { productId: "b", title: "Gift scarf", price: 35, currency: "USD", inStock: true, merchant: "shop.example" },
  { productId: "c", title: "Gift candle", price: 15, currency: "USD", inStock: false },
  { productId: "d", title: "Gift watch", price: 120, currency: "USD", inStock: true },
];

const llmSaying = (...answers: string[]): LlmClient & { calls: { system: string; user: string }[] } => {
  const calls: { system: string; user: string }[] = [];
  let i = 0;
  return { calls, generateJson: async (input) => (calls.push(input), answers[Math.min(i++, answers.length - 1)]) };
};

afterEach(() => vi.unstubAllGlobals());

describe("Channel3 normalization", () => {
  it("reads title, price, currency, stock and merchant from the first in-stock offer", () => {
    const hit = normalizeProduct({
      id: "p1",
      title: "Desk lamp",
      offers: [
        { domain: "out.example", price: { price: 30, currency: "usd" }, availability: "OutOfStock" },
        { domain: "nike.com", url: "https://buy.trychannel3.com/x", price: { price: 25.5, currency: "usd" }, availability: "InStock" },
      ],
    });
    expect(hit).toEqual(expect.objectContaining({ productId: "p1", price: 25.5, currency: "USD", inStock: true, merchant: "nike.com", url: "https://buy.trychannel3.com/x" }));
  });

  it("accepts an amount field and a plain number price", () => {
    expect(normalizeProduct({ id: "p", title: "t", offers: [{ price: { amount: 110, currency: "USD" }, availability: "InStock" }] })?.price).toBe(110);
    expect(normalizeProduct({ id: "p", title: "t", price: 9 })?.price).toBe(9);
  });

  it("drops products without id, title or a positive price", () => {
    expect(normalizeProduct({ title: "no id", price: 5 })).toBeUndefined();
    expect(normalizeProduct({ id: "x", title: "free", price: 0 })).toBeUndefined();
    expect(normalizeProduct("junk")).toBeUndefined();
  });
});

describe("Channel3 client", () => {
  it("POSTs /v1/search with the api key and the price filter", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ products: [{ id: "p1", title: "Lamp", price: 10 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const hits = await new Channel3Client({ apiKey: "k" }).search("desk lamp", { maxPrice: 50, limit: 5 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.trychannel3.com/v1/search");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(JSON.parse(String(init.body))).toEqual({ query: "desk lamp", limit: 5, filters: { price: { max_price: 50 } } });
    expect(hits).toHaveLength(1);
  });

  it("returns undefined for an unknown product and throws on other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await new Channel3Client({ apiKey: "k" }).getProduct("zzz")).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad key", { status: 401 })));
    await expect(new Channel3Client({ apiKey: "k" }).search("x")).rejects.toThrow(/Channel3 401/);
  });
});

describe("Mandate agent", () => {
  it("without a model, proposes the most relevant in-stock item under the cap", async () => {
    const run = await runMandate({ mandate, catalog: new DemoCatalog(items) });
    expect(run.usedAi).toBe(false);
    expect(run.candidates.map((c) => c.productId)).toEqual(["a", "b"]);
    expect(run.proposal).toEqual(expect.objectContaining({ mandateId: "m1", productId: "a", price: 20, seller: "shop.example" }));
  });

  it("never fills listedPrice itself (the Guardian re-reads the listing)", async () => {
    const run = await runMandate({ mandate, catalog: new DemoCatalog(items) });
    expect(run.proposal).not.toHaveProperty("listedPrice");
  });

  it("uses the model to build the query and pick a candidate", async () => {
    const llm = llmSaying(JSON.stringify({ query: "gift for mom" }), JSON.stringify({ index: 1, reasoning: "A scarf is a warmer gift." }));
    const run = await runMandate({ mandate, catalog: new DemoCatalog(items), llm });
    expect(run.usedAi).toBe(true);
    expect(run.query).toBe("gift for mom");
    expect(run.proposal?.productId).toBe("b");
    expect(run.proposal?.reasoning).toBe("A scarf is a warmer gift.");
    expect(llm.calls[1].system).toMatch(/untrusted/);
  });

  it("makes no proposal when the model says nothing fits", async () => {
    const llm = llmSaying(JSON.stringify({ query: "gift" }), JSON.stringify({ index: -1, reasoning: "None of these are gifts for a mother." }));
    const run = await runMandate({ mandate, catalog: new DemoCatalog(items), llm });
    expect(run.proposal).toBeUndefined();
    expect(run.note).toMatch(/None of the results fit/);
  });

  it("falls back to the deterministic pick when the model answers badly", async () => {
    const run = await runMandate({ mandate, catalog: new DemoCatalog(items), llm: llmSaying("not json", "{\"index\": 99, \"reasoning\": \"x\"}") });
    expect(run.proposal?.productId).toBe("a");
  });

  it("reports when nothing in stock fits the cap", async () => {
    const run = await runMandate({ mandate: { ...mandate, maxPerPurchase: 10 }, catalog: new DemoCatalog(items) });
    expect(run.proposal).toBeUndefined();
    expect(run.candidates).toHaveLength(0);
  });

  it("strips amounts from the goal for the fallback query", () => {
    expect(queryFromGoal("a birthday gift for my mom up to $40")).toBe("a birthday gift for my mom");
  });
});

describe("Natural-language mandate", () => {
  const now = () => new Date("2026-11-03T15:00:00Z");

  it("returns a draft and sends today's date to the model", async () => {
    const llm = llmSaying(JSON.stringify({ goal: "Birthday gift for mom", currency: "usd", maxPerPurchase: 40, maxMonthly: 100, allowedCategories: [], deliverBy: "2026-11-13", requireHumanAbove: 30 }));
    const r = await parseMandateText("gift for mom, max $40, by next Friday", llm, now);
    expect(r.ok && r.draft).toEqual(expect.objectContaining({ currency: "USD", maxPerPurchase: 40, deliverBy: "2026-11-13" }));
    expect(r.ok && r.questions).toEqual([]);
    expect(JSON.parse(llm.calls[0].user).today).toBe("2026-11-03");
  });

  it("asks the user instead of inventing a cap", async () => {
    const llm = llmSaying(JSON.stringify({ goal: "Headphones", currency: "USD", maxPerPurchase: null, maxMonthly: null, allowedCategories: [], deliverBy: null, requireHumanAbove: null }));
    const r = await parseMandateText("buy me headphones", llm, now);
    expect(r.ok && r.questions).toHaveLength(2);
  });

  it("fails cleanly on a bad model answer", async () => {
    const r = await parseMandateText("x", llmSaying("{\"goal\": 5}"), now);
    expect(r.ok).toBe(false);
  });
});

describe("Separation of powers", () => {
  it("the buyer agent and the catalog never import the PayPal client", () => {
    for (const dir of ["src/mandate", "src/channel3"]) {
      for (const f of readdirSync(dir)) {
        const code = readFileSync(join(dir, f), "utf8");
        expect(code, `${dir}/${f}`).not.toMatch(/from\s+["'][^"']*paypal[^"']*["']/i);
      }
    }
  });
});

describe("Shop endpoint (demo catalog, no keys)", () => {
  it("runs Mandate, then the Guardian re-reads the listing and approves", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "");
    vi.stubEnv("AI_API_KEY", "");
    vi.resetModules();
    const { app } = await import("../src/server.js");
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const m = await (await fetch(`${base}/api/mandates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: "a gift for mom", maxPerPurchase: 40, maxMonthly: 100 }),
      })).json();
      const res = await fetch(`${base}/api/mandates/${m.id}/shop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.run.source).toBe("demo");
      expect(body.record.proposal.listedPrice).toBe(body.record.proposal.price);
      expect(body.record.decision.findings.map((f: { rule: string }) => f.rule)).toContain("price_matches_listing");
      expect(body.record.status).toBe("approved");
    } finally {
      server.close();
      vi.unstubAllEnvs();
    }
  });
});
