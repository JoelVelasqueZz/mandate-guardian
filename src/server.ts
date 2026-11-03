import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { MandateSchema, ProposalSchema, type AuditRecord, type Mandate, type Proposal } from "./types.js";
import { review } from "./guardian/guardian.js";
import { reconcile } from "./guardian/reconcile.js";
import { aiReviewerFromEnv } from "./guardian/ai-reviewer.js";
import { llmFromEnv } from "./guardian/llm.js";
import { catalogFromEnv, type Catalog } from "./channel3/client.js";
import { runMandate } from "./mandate/agent.js";
import { parseMandateText } from "./mandate/parse-mandate.js";
import { Store } from "./store.js";
import { paypalFromEnv } from "./paypal/client.js";

const app = express();
app.use(express.json());
const store = new Store();
const aiReviewer = aiReviewerFromEnv(); // undefined unless AI_API_KEY and AI_MODEL are set
const llm = llmFromEnv(); // same model, used by the buyer agent
const catalog: Catalog = catalogFromEnv(); // live Channel3 with CHANNEL3_API_KEY, labeled demo data otherwise

app.get("/api/health", (_req, res) => res.json({ ok: true, catalog: catalog.source, ai: Boolean(llm) }));

// 0. Natural language -> mandate draft. The user edits and saves it with POST /api/mandates.
app.post("/api/mandates/parse", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  if (!llm) return res.status(503).json({ error: "AI model not configured (set AI_API_KEY and AI_MODEL)" });
  const result = await parseMandateText(text, llm);
  res.status(result.ok ? 200 : 422).json(result);
});

// 1. The user sets a mandate.
app.post("/api/mandates", (req, res) => {
  const parsed = MandateSchema.safeParse({ id: randomUUID(), ...req.body });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  store.mandates.set(parsed.data.id, parsed.data);
  res.status(201).json(parsed.data);
});

/**
 * Guardian side of a proposal: re-read the live listing (never trust the buyer's listedPrice),
 * run the rules and the AI reviewer, and store the audit record.
 */
async function submitProposal(mandate: Mandate, proposal: Proposal): Promise<AuditRecord> {
  let listingUnavailable = false;
  if (proposal.productId) {
    try {
      const live = await catalog.getProduct(proposal.productId);
      if (live) proposal.listedPrice = live.price;
      else listingUnavailable = true;
    } catch {
      listingUnavailable = true;
    }
    if (listingUnavailable) delete proposal.listedPrice;
  }

  const decision = await review(mandate, proposal, { spentThisMonth: store.spentThisMonth(mandate.id) }, aiReviewer);
  if (listingUnavailable) {
    // Can only make the verdict stricter, like the AI reviewer.
    decision.findings.push({ rule: "listing_recheck", ok: true, detail: "The live listing could not be re-read; a human must confirm." });
    if (decision.verdict === "approve") decision.verdict = "ask_human";
  }
  const status = decision.verdict === "approve" ? "approved" : decision.verdict === "block" ? "blocked" : "awaiting_human";
  const record: AuditRecord = { proposal, decision, status, updatedAt: "" };
  store.upsert(record);
  return record;
}

// 2. A proposal is submitted. The Guardian reviews it BEFORE any payment.
app.post("/api/proposals", async (req, res) => {
  const parsed = ProposalSchema.safeParse({ id: randomUUID(), ...req.body });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const mandate = store.mandates.get(parsed.data.mandateId);
  if (!mandate) return res.status(404).json({ error: "mandate not found" });
  res.status(201).json(await submitProposal(mandate, parsed.data));
});

// 2b. The buyer agent (Mandate) shops for a mandate and its proposal goes straight to the Guardian.
app.post("/api/mandates/:id/shop", async (req, res) => {
  const mandate = store.mandates.get(req.params.id);
  if (!mandate) return res.status(404).json({ error: "mandate not found" });
  const query = typeof req.body?.query === "string" ? req.body.query : undefined;
  try {
    const run = await runMandate({ mandate, catalog, llm, query });
    if (!run.proposal) return res.json({ run });
    const record = await submitProposal(mandate, ProposalSchema.parse({ id: randomUUID(), ...run.proposal }));
    res.status(201).json({ run, record });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
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
