import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { MandateSchema, ProposalSchema, type AuditRecord } from "./types.js";
import { review } from "./guardian/guardian.js";
import { reconcile } from "./guardian/reconcile.js";
import { Store } from "./store.js";
import { paypalFromEnv } from "./paypal/client.js";

const app = express();
app.use(express.json());
const store = new Store();

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 1. The user sets a mandate (the AI that turns natural language into this schema comes later).
app.post("/api/mandates", (req, res) => {
  const parsed = MandateSchema.safeParse({ id: randomUUID(), ...req.body });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  store.mandates.set(parsed.data.id, parsed.data);
  res.status(201).json(parsed.data);
});

// 2. The buyer agent (Mandate) submits a proposal. The Guardian reviews it BEFORE any payment.
app.post("/api/proposals", async (req, res) => {
  const parsed = ProposalSchema.safeParse({ id: randomUUID(), ...req.body });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const proposal = parsed.data;
  const mandate = store.mandates.get(proposal.mandateId);
  if (!mandate) return res.status(404).json({ error: "mandate not found" });

  const decision = await review(mandate, proposal, { spentThisMonth: store.spentThisMonth(mandate.id) } /*, aiReviewer */);
  const status = decision.verdict === "approve" ? "approved" : decision.verdict === "block" ? "blocked" : "awaiting_human";
  const record: AuditRecord = { proposal, decision, status, updatedAt: "" };
  store.upsert(record);
  res.status(201).json(record);
});

// 3. A human confirms a purchase that Guardian flagged.
app.post("/api/proposals/:id/confirm", (req, res) => {
  const record = store.records.get(req.params.id);
  if (!record) return res.status(404).json({ error: "not found" });
  if (record.status !== "awaiting_human") return res.status(409).json({ error: `status is ${record.status}` });
  record.status = "approved";
  store.upsert(record);
  res.json(record);
});

// 4. Pay (only approved proposals). Creates an AUTHORIZE order; buyer approval + authorize/capture
//    are the next steps to wire once the sandbox flow is confirmed (see docs/PLAN.md).
app.post("/api/proposals/:id/pay", async (req, res) => {
  const record = store.records.get(req.params.id);
  if (!record) return res.status(404).json({ error: "not found" });
  if (record.status !== "approved") return res.status(409).json({ error: `cannot pay a proposal in status ${record.status}` });
  try {
    const paypal = paypalFromEnv();
    const order = await paypal.createOrder(record.proposal.price, record.proposal.currency, record.proposal.title, "AUTHORIZE", record.proposal.id);
    record.paypal = { orderId: order.id };
    store.upsert(record);
    res.json({ record, approveUrl: order.links.find((l) => l.rel === "approve")?.href });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// 5. Reconcile after payment.
app.post("/api/proposals/:id/reconcile", (req, res) => {
  const record = store.records.get(req.params.id);
  if (!record) return res.status(404).json({ error: "not found" });
  if (typeof req.body?.charged === "number") record.paypal = { ...record.paypal, charged: req.body.charged };
  record.reconciliation = reconcile(record);
  record.status = record.reconciliation.match ? "reconciled" : "alert";
  store.upsert(record);
  res.json(record);
});

// Feed for the AG Grid dashboard.
app.get("/api/records", (_req, res) => res.json([...store.records.values()]));

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") app.listen(port, () => console.log(`Mandate & Guardian on http://localhost:${port}`));

export { app, store };
