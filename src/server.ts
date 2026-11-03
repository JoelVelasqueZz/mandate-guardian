import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { MandateSchema, ProposalSchema, type AuditRecord } from "./types.js";
import { review } from "./guardian/guardian.js";
import { Store } from "./store.js";
import { createPayPalRouter } from "./paypal/routes.js";

const app = express();
app.use(express.json());
const store = new Store();

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 1. The user sets a mandate (the AI that turns natural language into this schema comes later).
app.post("/api/mandates", (req, res) => {
  const parsed = MandateSchema.safeParse({ ...req.body, id: randomUUID() });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  store.mandates.set(parsed.data.id, parsed.data);
  res.status(201).json(parsed.data);
});

// 2. The buyer agent (Mandate) submits a proposal. The Guardian reviews it BEFORE any payment.
app.post("/api/proposals", async (req, res) => {
  const parsed = ProposalSchema.safeParse({ ...req.body, id: randomUUID() });
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

// PayPal sandbox flows, callbacks and reconciliation.
app.use(createPayPalRouter(store));

// Feed for the AG Grid dashboard.
app.get("/api/records", (_req, res) => res.json([...store.records.values()]));

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") app.listen(port, "0.0.0.0", () => console.log(`Mandate & Guardian on http://localhost:${port}`));

export { app, store };
