import { describe, it, expect } from "vitest";
import { review } from "../src/guardian/guardian.js";
import { reconcile } from "../src/guardian/reconcile.js";
import type { AuditRecord, Mandate, Proposal } from "../src/types.js";

const mandate: Mandate = {
  id: "m1",
  goal: "a gift up to $40, delivered by Friday",
  currency: "USD",
  maxPerPurchase: 40,
  maxMonthly: 100,
  allowedCategories: ["gifts"],
  deliverBy: "2026-11-06",
  requireHumanAbove: 30,
};

const base: Proposal = {
  id: "p1",
  mandateId: "m1",
  title: "Mug",
  category: "gifts",
  price: 20,
  listedPrice: 20,
  currency: "USD",
  estimatedDelivery: "2026-11-05",
  reasoning: "",
};

describe("Guardian rules", () => {
  it("approves a proposal that passes every rule", async () => {
    const d = await review(mandate, base, { spentThisMonth: 0 });
    expect(d.verdict).toBe("approve");
  });

  it("blocks a purchase over the per-purchase cap", async () => {
    const d = await review(mandate, { ...base, price: 55, listedPrice: 55 }, { spentThisMonth: 0 });
    expect(d.verdict).toBe("block");
    expect(d.findings.find((f) => f.rule === "per_purchase_cap")?.ok).toBe(false);
  });

  it("blocks when the monthly cap would be exceeded", async () => {
    const d = await review(mandate, base, { spentThisMonth: 90 });
    expect(d.verdict).toBe("block");
  });

  it("blocks a category outside the mandate", async () => {
    const d = await review(mandate, { ...base, category: "electronics" }, { spentThisMonth: 0 });
    expect(d.verdict).toBe("block");
  });

  it("blocks late delivery", async () => {
    const d = await review(mandate, { ...base, estimatedDelivery: "2026-11-10" }, { spentThisMonth: 0 });
    expect(d.verdict).toBe("block");
  });

  it("blocks when the price differs from the live listing", async () => {
    const d = await review(mandate, { ...base, listedPrice: 15 }, { spentThisMonth: 0 });
    expect(d.verdict).toBe("block");
  });

  it("asks a human above the confirmation threshold", async () => {
    const d = await review(mandate, { ...base, price: 35, listedPrice: 35 }, { spentThisMonth: 0 });
    expect(d.verdict).toBe("ask_human");
  });

  it("AI reviewer can escalate but never override a block", async () => {
    const suspicious = async () => ({ suspicious: true, explanation: "Seller looks unusual." });
    const ok = await review(mandate, base, { spentThisMonth: 0 }, suspicious);
    expect(ok.verdict).toBe("ask_human");
    const blocked = await review(mandate, { ...base, price: 55, listedPrice: 55 }, { spentThisMonth: 0 }, async () => ({ suspicious: false, explanation: "Looks fine." }));
    expect(blocked.verdict).toBe("block");
  });
});

describe("Reconciliation", () => {
  const rec = (charged?: number): AuditRecord => ({ proposal: base, status: "captured", paypal: { charged }, updatedAt: "" });

  it("matches when charged equals approved", () => {
    expect(reconcile(rec(20)).match).toBe(true);
  });

  it("flags an overcharge", () => {
    const r = reconcile(rec(27.5));
    expect(r.match).toBe(false);
    expect(r.detail).toContain("+7.5");
  });

  it("flags a missing charge", () => {
    expect(reconcile(rec(undefined)).match).toBe(false);
  });
});
