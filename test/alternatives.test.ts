import { describe, it, expect, vi, afterEach } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { DemoCatalog, DEMO_PRODUCTS, type ProductHit } from "../src/channel3/client.js";
import { findAlternatives, proposalFromHit } from "../src/guardian/alternatives.js";
import type { Mandate, Proposal } from "../src/types.js";

const mandate: Mandate = {
  id: "m1",
  goal: "a gift for mom up to $40",
  currency: "USD",
  maxPerPurchase: 40,
  maxMonthly: 100,
  allowedCategories: [],
};
const blocked: Proposal = { id: "p1", mandateId: "m1", productId: "demo-watch", title: "Classic leather watch", price: 129, currency: "USD", reasoning: "" };

afterEach(() => vi.unstubAllEnvs());

describe("Alternatives for a blocked proposal", () => {
  it("returns in-stock products under the cap, never the blocked one", async () => {
    const { alternatives, maxPrice } = await findAlternatives(new DemoCatalog(), mandate, blocked, 0);
    expect(maxPrice).toBe(40);
    const ids = alternatives.map((a) => a.productId);
    expect(ids).toContain("demo-mug");
    expect(ids).toContain("demo-scarf");
    expect(ids).not.toContain("demo-watch"); // over the cap and the blocked product
    expect(ids).not.toContain("demo-candle"); // out of stock
    expect(alternatives.every((a) => a.price <= 40)).toBe(true);
  });

  it("uses what is left of the month when that is lower than the cap", async () => {
    const { alternatives, maxPrice } = await findAlternatives(new DemoCatalog(), mandate, blocked, 80);
    expect(maxPrice).toBe(20);
    expect(alternatives.every((a) => a.price <= 20)).toBe(true);
  });

  it("returns nothing when the month is spent", async () => {
    expect(await findAlternatives(new DemoCatalog(), mandate, blocked, 100)).toEqual({ alternatives: [], maxPrice: 0 });
  });

  it("drops a product whose known category is not allowed, but keeps one with no category", async () => {
    const items: ProductHit[] = [
      { productId: "a", title: "Gift A", price: 10, currency: "USD", inStock: true, category: "electronics" },
      { productId: "b", title: "Gift B", price: 10, currency: "USD", inStock: true, category: "gifts" },
      { productId: "c", title: "Gift C", price: 10, currency: "USD", inStock: true },
      { productId: "d", title: "Gift D", price: 10, currency: "EUR", inStock: true },
    ];
    const { alternatives } = await findAlternatives(new DemoCatalog(items), { ...mandate, allowedCategories: ["gifts"] }, blocked, 0);
    expect(alternatives.map((a) => a.productId).sort()).toEqual(["b", "c"]);
  });

  it("builds the replacement proposal from catalog data only", () => {
    const hit = DEMO_PRODUCTS[0];
    const p = proposalFromHit(mandate, hit, blocked);
    expect(p).toMatchObject({ mandateId: "m1", productId: hit.productId, title: hit.title, price: hit.price });
    expect(p).not.toHaveProperty("listedPrice");
    expect(p.reasoning).toContain("Classic leather watch");
  });
});

describe("Server: alternatives and swap", () => {
  it("offers alternatives for a blocked proposal and sends one back through the Guardian", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "");
    vi.stubEnv("AI_API_KEY", "");
    vi.resetModules();
    const { app } = await import("../src/server.js");
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, body?: unknown) => {
      const res = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    try {
      const m = await call("/api/mandates", { goal: "a gift for mom", maxPerPurchase: 40, maxMonthly: 100 });
      const watch = await call("/api/proposals", { mandateId: m.body.id, productId: "demo-watch", title: "Classic leather watch gift for mom", price: 129, currency: "USD", reasoning: "" });
      expect(watch.body.status).toBe("blocked");

      const alts = await call(`/api/proposals/${watch.body.proposal.id}/alternatives`);
      expect(alts.status).toBe(200);
      expect(alts.body.source).toBe("demo");
      const pick = alts.body.alternatives[0];
      expect(pick.price).toBeLessThanOrEqual(40);

      const swapped = await call(`/api/proposals/${watch.body.proposal.id}/swap`, { productId: pick.productId });
      expect(swapped.status).toBe(201);
      expect(swapped.body.status).toBe("approved");
      expect(swapped.body.receipt).toBeTruthy(); // the Guardian signed the replacement like any other approval
      expect(swapped.body.proposal.reasoning).toContain("alternative");

      // Only a blocked proposal can be replaced, and the product must exist.
      expect((await call(`/api/proposals/${swapped.body.proposal.id}/alternatives`)).status).toBe(409);
      expect((await call(`/api/proposals/${watch.body.proposal.id}/swap`, { productId: "ghost-1" })).status).toBe(404);
      expect((await call(`/api/proposals/${watch.body.proposal.id}/swap`, {})).status).toBe(400);
    } finally {
      server.close();
    }
  });
});
