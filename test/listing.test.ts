import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { review } from "../src/guardian/guardian.js";
import { verifyListing } from "../src/guardian/listing.js";
import type { Catalog, ProductHit } from "../src/channel3/client.js";
import type { Mandate, Proposal } from "../src/types.js";

const mandate: Mandate = {
  id: "m1",
  goal: "a gift",
  currency: "USD",
  maxPerPurchase: 40,
  maxMonthly: 100,
  allowedCategories: [],
};

const proposal: Proposal = { id: "p1", mandateId: "m1", productId: "x1", title: "Mug", price: 20, currency: "USD", reasoning: "" };
const hit: ProductHit = { productId: "x1", title: "Mug", price: 20, currency: "USD", inStock: true };

const catalogWith = (get: Catalog["getProduct"]): Catalog => ({ source: "channel3", search: async () => [], getProduct: get });

afterEach(() => vi.unstubAllEnvs());

describe("verifyListing", () => {
  it("returns the live price from the catalog", async () => {
    const v = await verifyListing(catalogWith(async () => hit), proposal);
    expect(v).toEqual(expect.objectContaining({ ok: true, listedPrice: 20 }));
  });

  it("fails when the proposal has no product id", async () => {
    const v = await verifyListing(catalogWith(async () => hit), { ...proposal, productId: undefined });
    expect(v.ok).toBe(false);
    expect(v.listedPrice).toBeUndefined();
  });

  it("fails when the product is not in the catalog", async () => {
    const v = await verifyListing(catalogWith(async () => undefined), proposal);
    expect(v.ok).toBe(false);
  });

  it("fails when the catalog cannot be reached", async () => {
    const v = await verifyListing(catalogWith(async () => { throw new Error("timeout"); }), proposal);
    expect(v.ok).toBe(false);
    expect(v.listedPrice).toBeUndefined();
  });

  it("fails when the listing currency differs from the proposal", async () => {
    const v = await verifyListing(catalogWith(async () => ({ ...hit, currency: "EUR" })), proposal);
    expect(v.ok).toBe(false);
    expect(v.listedPrice).toBeUndefined();
  });
});

describe("Guardian rule: price_verified", () => {
  it("blocks an otherwise valid proposal whose price could not be verified", async () => {
    const d = await review(mandate, proposal, { spentThisMonth: 0, priceVerification: { ok: false, detail: "No productId." } });
    expect(d.verdict).toBe("block");
    expect(d.findings.find((f) => f.rule === "price_verified")?.ok).toBe(false);
  });

  it("does not block when the price was verified", async () => {
    const d = await review(mandate, { ...proposal, listedPrice: 20 }, { spentThisMonth: 0, priceVerification: { ok: true, detail: "Read from catalog." } });
    expect(d.verdict).toBe("approve");
  });

  it("an AI reviewer that says everything is fine cannot undo that block", async () => {
    const ai = async () => ({ suspicious: false, explanation: "Looks fine." });
    const d = await review(mandate, proposal, { spentThisMonth: 0, priceVerification: { ok: false, detail: "x" } }, ai);
    expect(d.verdict).toBe("block");
  });
});

describe("Proposal endpoint: the price comes from the catalog, not from the client", () => {
  async function withServer(run: (post: (path: string, body: unknown) => Promise<{ status: number; body: any }>, mandateId: string) => Promise<void>) {
    vi.stubEnv("CHANNEL3_API_KEY", "");
    vi.stubEnv("AI_API_KEY", "");
    vi.resetModules();
    const { app } = await import("../src/server.js");
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (path: string, body: unknown) => {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    try {
      const m = await post("/api/mandates", { goal: "a gift", maxPerPurchase: 40, maxMonthly: 100 });
      await run(post, m.body.id);
    } finally {
      server.close();
    }
  }
  const rule = (record: any, name: string) => record.decision.findings.find((f: { rule: string }) => f.rule === name);

  it("blocks a proposal without a product id even if the client sends a matching listedPrice", async () => {
    await withServer(async (post, mandateId) => {
      const r = await post("/api/proposals", { mandateId, title: "Anything", price: 10, listedPrice: 10 });
      expect(r.status).toBe(201);
      expect(r.body.status).toBe("blocked");
      expect(rule(r.body, "price_verified").ok).toBe(false);
      expect(r.body.proposal.listedPrice).toBeUndefined();
    });
  });

  it("ignores a listedPrice sent by the client and blocks a price that differs from the catalog", async () => {
    await withServer(async (post, mandateId) => {
      // demo-mug really costs 24; the client claims 5 and lists 5.
      const r = await post("/api/proposals", { mandateId, productId: "demo-mug", title: "Mug", price: 5, listedPrice: 5 });
      expect(r.body.status).toBe("blocked");
      expect(r.body.proposal.listedPrice).toBe(24);
      expect(rule(r.body, "price_matches_listing").ok).toBe(false);
    });
  });

  it("overwrites a forged listedPrice and approves when the price matches the catalog", async () => {
    await withServer(async (post, mandateId) => {
      const r = await post("/api/proposals", { mandateId, productId: "demo-mug", title: "Mug", price: 24, listedPrice: 999 });
      expect(r.body.status).toBe("approved");
      expect(r.body.proposal.listedPrice).toBe(24);
      expect(rule(r.body, "price_verified").ok).toBe(true);
    });
  });

  it("blocks an unknown product id", async () => {
    await withServer(async (post, mandateId) => {
      const r = await post("/api/proposals", { mandateId, productId: "does-not-exist", title: "Ghost", price: 10 });
      expect(r.body.status).toBe("blocked");
      expect(rule(r.body, "price_verified").ok).toBe(false);
    });
  });
});
