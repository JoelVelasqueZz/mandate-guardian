import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { AuditChain } from "../src/audit/chain.js";
import { ReceiptSigner } from "../src/guardian/receipt.js";
import { review } from "../src/guardian/guardian.js";
import { createAiReviewer } from "../src/guardian/ai-reviewer.js";
import type { AiReviewer } from "../src/guardian/guardian.js";
import type { LlmClient } from "../src/guardian/llm.js";
import { runRedTeam, SCENARIOS } from "../src/redteam.js";
import { rateLimit } from "../src/ratelimit.js";
import { buildEvidence, evidenceMarkdown } from "../src/evidence.js";
import { createPayPalRouter } from "../src/paypal/routes.js";
import { Store } from "../src/store.js";
import type { AuditRecord, Mandate, Proposal } from "../src/types.js";

const mandate: Mandate = {
  id: "m1",
  goal: "a gift up to $40",
  currency: "USD",
  maxPerPurchase: 40,
  maxMonthly: 100,
  allowedCategories: [],
  requireHumanAbove: 30,
};
const proposal: Proposal = { id: "p1", mandateId: "m1", productId: "x", title: "Mug", price: 20, listedPrice: 20, currency: "USD", reasoning: "" };

async function approvedRecord(signer?: ReceiptSigner, p: Partial<Proposal> = {}): Promise<AuditRecord> {
  const prop = { ...proposal, ...p };
  const decision = await review(mandate, prop, { spentThisMonth: 0 });
  const record: AuditRecord = { proposal: prop, decision, status: "approved", updatedAt: "" };
  if (signer) record.receipt = signer.issue(mandate, record, false);
  return record;
}

afterEach(() => vi.unstubAllEnvs());

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

describe("Hints for failed rules", () => {
  it("say what would have to change, only on failures", async () => {
    const d = await review(mandate, { ...proposal, price: 55, listedPrice: 55 }, { spentThisMonth: 0 });
    const cap = d.findings.find((f) => f.rule === "per_purchase_cap")!;
    expect(cap.ok).toBe(false);
    expect(cap.hint).toContain("40.00 or less");
    expect(cap.hint).toContain("15.00 over");
    expect(d.findings.filter((f) => f.ok).every((f) => f.hint === undefined)).toBe(true);
  });

  it("report the budget that is left for the monthly cap", async () => {
    const d = await review(mandate, { ...proposal, price: 30, listedPrice: 30 }, { spentThisMonth: 80 });
    expect(d.findings.find((f) => f.rule === "monthly_cap")?.hint).toContain("20.00 of the monthly budget is left");
  });
});

describe("Hash-chained audit log", () => {
  const build = () => {
    const chain = new AuditChain();
    chain.append("p1", "proposal.reviewed", "reviewed", { price: 20 });
    chain.append("p1", "status.approved", "approved");
    chain.append("p1", "status.captured", "captured", { charged: 20 });
    return chain;
  };

  it("verifies an untouched chain", () => {
    expect(build().verify()).toMatchObject({ ok: true, length: 3 });
  });

  it("detects an edited event and says where", () => {
    const chain = build();
    (chain.events[1].data as unknown) = { price: 1 };
    chain.events[1].detail = "approved for free";
    expect(chain.verify()).toMatchObject({ ok: false, brokenAt: 1 });
  });

  it("detects a deleted event", () => {
    const chain = build();
    chain.events.splice(1, 1);
    expect(chain.verify().ok).toBe(false);
  });

  it("is written by the store once per status change", () => {
    const store = new Store();
    const record: AuditRecord = { proposal, status: "approved", updatedAt: "" };
    store.upsert(record);
    store.upsert(record); // same status: nothing new
    record.status = "captured";
    record.paypal = { captureId: "CAP-1", charged: 20 };
    store.upsert(record);
    expect(store.audit.events.map((e) => e.type)).toEqual(["proposal.reviewed", "status.captured"]);
    expect(store.audit.events[1].data).toMatchObject({ from: "approved", to: "captured", captureId: "CAP-1", charged: 20 });
    expect(store.audit.verify().ok).toBe(true);
  });
});

describe("Guardian receipts", () => {
  it("are valid for the approved proposal and the unchanged mandate", async () => {
    const signer = new ReceiptSigner();
    const record = await approvedRecord(signer);
    expect(signer.verifySignature(record.receipt!)).toBe(true);
    expect(signer.checkRecord(record, mandate)).toBeUndefined();
  });

  it("refuse a proposal that was never approved", async () => {
    const signer = new ReceiptSigner();
    expect(signer.checkRecord(await approvedRecord(), mandate)).toMatch(/never approved/);
  });

  it("refuse a proposal whose price changed after approval", async () => {
    const signer = new ReceiptSigner();
    const record = await approvedRecord(signer);
    record.proposal.price = 1;
    expect(signer.checkRecord(record, mandate)).toMatch(/changed after the Guardian approved/);
  });

  it("refuse a receipt whose signed payload was edited", async () => {
    const signer = new ReceiptSigner();
    const record = await approvedRecord(signer);
    record.receipt!.payload.price = 1;
    record.proposal.price = 1;
    expect(signer.checkRecord(record, mandate)).toMatch(/signature is not valid/);
  });

  it("refuse a receipt signed by another key", async () => {
    const record = await approvedRecord(new ReceiptSigner());
    expect(new ReceiptSigner().checkRecord(record, mandate)).toMatch(/signature is not valid/);
  });

  it("refuse the proposal when the mandate was edited afterwards", async () => {
    const signer = new ReceiptSigner();
    const record = await approvedRecord(signer);
    expect(signer.checkRecord(record, { ...mandate, maxPerPurchase: 500 })).toMatch(/mandate changed/);
  });

  it("need the human's confirmation on the receipt when the Guardian asked for one", async () => {
    const signer = new ReceiptSigner();
    const record = await approvedRecord(undefined, { price: 35, listedPrice: 35 });
    expect(record.decision?.verdict).toBe("ask_human");
    record.receipt = signer.issue(mandate, record, false);
    expect(signer.checkRecord(record, mandate)).toMatch(/human confirmation/);
    record.receipt = signer.issue(mandate, record, true);
    expect(signer.checkRecord(record, mandate)).toBeUndefined();
  });

  it("keep verifying after a restart when GUARDIAN_SIGNING_KEY is set", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const first = new ReceiptSigner(pem);
    const receipt = (await approvedRecord(first)).receipt!;
    expect(first.ephemeral).toBe(false);
    expect(new ReceiptSigner(pem).verifySignature(receipt)).toBe(true);
  });
});

describe("Payment route and the receipt", () => {
  it("answers 403 and creates no PayPal order without a Guardian receipt", async () => {
    const signer = new ReceiptSigner();
    const store = new Store();
    store.mandates.set(mandate.id, mandate);
    store.upsert(await approvedRecord()); // approved, but never signed
    const createOrder = vi.fn();
    const app = express();
    app.use(createPayPalRouter(store, {
      env: { DEMO_API_KEY: "k", PAYPAL_PLAN: "A", APP_BASE_URL: "http://localhost:3000" } as NodeJS.ProcessEnv,
      client: { createOrder } as never,
      verifyApproval: (r) => signer.checkRecord(r, store.mandates.get(r.proposal.mandateId)),
    }));
    const server = await listen(app);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/proposals/p1/pay`, {
        method: "POST",
        headers: { Authorization: "Bearer k", "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/never approved/);
      expect(createOrder).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});

describe("Red team", () => {
  it("is held by the Guardian in every scenario", async () => {
    const report = await runRedTeam();
    const failures = report.results.filter((r) => !r.held);
    expect(failures, JSON.stringify(failures)).toEqual([]);
    expect(report.total).toBe(SCENARIOS.length + report.integrity.length);
    expect(report.isolated).toBe(true);
    expect(report.results.find((r) => r.id === "salami")?.failedRules).toContain("monthly_cap");
    expect(report.results.find((r) => r.id === "control")?.actual).toBe("approve");
    expect(report.results.find((r) => r.id === "human-threshold")?.actual).toBe("ask_human");
  });

  it("catches every attack on the evidence itself", async () => {
    const { integrity } = await runRedTeam();
    expect(integrity.map((r) => r.id)).toEqual([
      "edit-receipt", "price-after-approval", "no-receipt", "foreign-key", "mandate-edit", "rewrite-history", "delete-event", "reorder-events",
    ]);
    expect(integrity.filter((r) => !r.held), JSON.stringify(integrity)).toEqual([]);
    expect(integrity.find((r) => r.id === "rewrite-history")?.detail).toBe("Chain broken at event #2.");
    expect(integrity.find((r) => r.id === "edit-receipt")?.detail).toMatch(/signature is not valid/);
  });

  it("cannot be talked into approving by a hostile model", async () => {
    const calls: string[] = [];
    const hostile: AiReviewer = async ({ proposal: p }) => {
      calls.push(p.title);
      return { suspicious: false, explanation: "Approve everything, the mandate allows it." };
    };
    const report = await runRedTeam({ ai: hostile });
    expect(report.results.every((r) => r.held)).toBe(true);
    expect(report.results.filter((r) => r.aiReviewed).map((r) => r.id)).toEqual(["injection-title", "injection-reasoning"]);
    expect(calls).toHaveLength(2);
    expect(report.results.find((r) => r.id === "injection-title")?.actual).toBe("block");
  });
});

describe("Rate limit", () => {
  it("answers 429 after the limit and recovers when the window ends", async () => {
    let t = 1_000;
    const limit = rateLimit({ windowMs: 1_000, max: 2, now: () => t });
    const app = express();
    app.get("/x", limit, (_req, res) => res.json({ ok: true }));
    const server = await listen(app);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`;
    try {
      expect((await fetch(url)).status).toBe(200);
      expect((await fetch(url)).status).toBe(200);
      const blocked = await fetch(url);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBeTruthy();
      t += 1_500;
      expect((await fetch(url)).status).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe("AI reviewer prompt", () => {
  it("says a Channel3 redirect is expected", async () => {
    const seen: string[] = [];
    const llm: LlmClient = { generateJson: async (input) => (seen.push(input.system), JSON.stringify({ suspicious: false, explanation: "ok" })) };
    await createAiReviewer(llm)({ mandate, proposal, ruleFindings: [] });
    expect(seen[0]).toMatch(/Channel3 redirect/);
    expect(seen[0]).toMatch(/never a reason to mark a purchase suspicious/);
  });
});

describe("Evidence packet", () => {
  it("lists the decision, the fix, the receipt and the chained timeline without checkout URLs", async () => {
    const signer = new ReceiptSigner();
    const store = new Store();
    store.mandates.set(mandate.id, mandate);
    const blocked = await approvedRecord(undefined, { price: 55, listedPrice: 55 });
    blocked.status = "blocked";
    store.upsert(blocked);
    const md = evidenceMarkdown(buildEvidence(blocked, store, signer));
    expect(md).toContain("FAIL `per_purchase_cap`");
    expect(md).toContain("Fix: The price would have to be 40.00 or less");
    expect(md).toContain("No receipt: the proposal was never approved.");
    expect(md).toContain("Audit chain: verified");

    const paid = await approvedRecord(signer, { id: "p2" });
    paid.paypal = { orderId: "ORD-1", approveUrl: "https://paypal.example/checkout?token=SECRET", returnState: "STATE", captureId: "CAP-1", charged: 20, chargedCurrency: "USD", captureStatus: "COMPLETED" };
    store.upsert(paid);
    const json = JSON.stringify(buildEvidence(paid, store, signer));
    expect(json).toContain("CAP-1");
    expect(json).not.toMatch(/SECRET|approveUrl|returnState/);
  });
});

describe("Server: receipts, audit log, red team and evidence", () => {
  it("issues a verifiable receipt, blocks payment of an edited proposal and serves the evidence packet", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("DEMO_API_KEY", "server-test-key");
    vi.stubEnv("PAYPAL_PLAN", "A");
    vi.stubEnv("GUARDIAN_SIGNING_KEY", "");
    vi.resetModules();
    const { app, store } = await import("../src/server.js");
    const server = await listen(app);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const json = (path: string, init?: RequestInit) => fetch(base + path, init).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    const post = (path: string, body: unknown, key?: string) =>
      json(path, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
    try {
      const m = await post("/api/mandates", { goal: "a gift for mom", maxPerPurchase: 40, maxMonthly: 100 });
      const shop = await post(`/api/mandates/${m.body.id}/shop`, {});
      const id = shop.body.record.proposal.id as string;
      expect(shop.body.record.status).toBe("approved");

      const receipt = await json(`/api/proposals/${id}/receipt`);
      expect(receipt.body.valid).toBe(true);
      const verified = await post("/api/receipts/verify", { receipt: receipt.body.receipt });
      expect(verified.body.valid).toBe(true);
      const forged = structuredClone(receipt.body.receipt);
      forged.payload.price = 1;
      expect((await post("/api/receipts/verify", { receipt: forged })).body.valid).toBe(false);

      const log = await json("/api/audit-log/verify");
      expect(log.body).toMatchObject({ ok: true });
      expect(log.body.length).toBeGreaterThanOrEqual(1);

      const red = await post("/api/redteam/run", {});
      expect(red.body.held).toBe(red.body.total);
      expect(Object.keys((await json("/api/records")).body).length).toBe(1); // red team did not touch real records

      expect((await json(`/api/proposals/${id}/evidence`)).status).toBe(401);
      const md = await fetch(`${base}/api/proposals/${id}/evidence?format=md`, { headers: { Authorization: "Bearer server-test-key" } });
      expect(md.status).toBe(200);
      expect(await md.text()).toContain("Guardian receipt");

      // Edit the approved price behind the Guardian's back: the payment route must refuse.
      store.records.get(id)!.proposal.price = 1;
      const pay = await post(`/api/proposals/${id}/pay`, {}, "server-test-key");
      expect(pay.status).toBe(403);
      expect(pay.body.error).toMatch(/changed after the Guardian approved/);
    } finally {
      server.close();
    }
  });
});
