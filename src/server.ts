import "dotenv/config";
import express from "express";
import compression from "compression";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { MandateSchema, ProposalSchema, type AuditRecord, type Mandate, type Proposal } from "./types.js";
import { aiReviewerFromEnv } from "./guardian/ai-reviewer.js";
import { reviewAndStore } from "./guardian/submit.js";
import { signerFromEnv } from "./guardian/receipt.js";
import { runRedTeam } from "./redteam.js";
import { findAlternatives, proposalFromHit } from "./guardian/alternatives.js";
import { rateLimit } from "./ratelimit.js";
import { buildEvidence, evidenceMarkdown } from "./evidence.js";
import { llmFromEnv } from "./guardian/llm.js";
import { catalogFromEnv, type Catalog } from "./channel3/client.js";
import { runMandate } from "./mandate/agent.js";
import { parseMandateText } from "./mandate/parse-mandate.js";
import { Store } from "./store.js";
import { createPayPalRouter, demoKeyGate } from "./paypal/routes.js";
import { createAiTurnHandler } from "./ai-turn.js";

const app = express();
app.set("trust proxy", 1); // behind Render's proxy, so rate limits see the real client address
app.use(compression());
app.use(express.json({ limit: "1mb" })); // the Studio assistant sends conversation history

// Security and Best Practices HTTP headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
const store = new Store();
const aiReviewer = aiReviewerFromEnv(); // undefined unless AI_API_KEY and AI_MODEL are set
const llm = llmFromEnv(); // same model, used by the buyer agent
const catalog: Catalog = catalogFromEnv(); // live Channel3 with CHANNEL3_API_KEY, labeled demo data otherwise
const signer = signerFromEnv(); // signs the Guardian's approvals; the payment route requires the receipt

// Routes that spend model or catalog quota get a per-IP limit.
const limitShop = rateLimit({ windowMs: 60_000, max: 20 });
const limitParse = rateLimit({ windowMs: 60_000, max: 20 });
const limitProposals = rateLimit({ windowMs: 60_000, max: 60 });
const limitRedTeam = rateLimit({ windowMs: 60_000, max: 10 });
const demoKey = demoKeyGate(process.env);
const limitAssistant = rateLimit({ windowMs: 60_000, max: 30 });

// The analytics assistant (AG Studio) talks to Gemini through this route, so the key and model stay on the
// server. It needs the demo key like every route that spends quota, and it can only read dashboard data.
app.post("/api/ai/turn", limitAssistant, demoKey, createAiTurnHandler({ apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL }));

app.get("/api/health", (_req, res) => res.json({
  ok: true, catalog: catalog.source, ai: Boolean(llm),
  guardianKeyId: signer.keyId, receiptsEphemeral: signer.ephemeral,
  paypalPlan: process.env.PAYPAL_PLAN,
  demoOvercharge: process.env.ENABLE_DEMO_SCENARIO === "true",
}));

// 0. Natural language -> mandate draft. The user edits and saves it with POST /api/mandates.
app.post("/api/mandates/parse", limitParse, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  if (!llm) return res.status(503).json({ error: "AI model not configured (set AI_API_KEY and AI_MODEL)" });
  const result = await parseMandateText(text, llm);
  res.status(result.ok ? 200 : 422).json(result);
});

// 1. The user sets a mandate.
app.post("/api/mandates", (req, res) => {
  const parsed = MandateSchema.safeParse({ ...req.body, id: randomUUID() });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  store.mandates.set(parsed.data.id, parsed.data);
  res.status(201).json(parsed.data);
});

app.get("/api/mandates", (_req, res) => res.json([...store.mandates.values()]));

const submitProposal = (mandate: Mandate, proposal: Proposal) =>
  reviewAndStore({ catalog, store, ai: aiReviewer, signer }, mandate, proposal);

// 2. A proposal is submitted. The Guardian reviews it BEFORE any payment.
app.post("/api/proposals", limitProposals, async (req, res) => {
  const parsed = ProposalSchema.safeParse({ ...req.body, id: randomUUID() });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const mandate = store.mandates.get(parsed.data.mandateId);
  if (!mandate) return res.status(404).json({ error: "mandate not found" });
  res.status(201).json(await submitProposal(mandate, parsed.data));
});

// 2b. The buyer agent (Mandate) shops for a mandate and its proposal goes straight to the Guardian.
app.post("/api/mandates/:id/shop", limitShop, async (req, res) => {
  const mandate = store.mandates.get(req.params.id);
  if (!mandate) return res.status(404).json({ error: "mandate not found" });
  const query = typeof req.body?.query === "string" ? req.body.query : undefined;
  try {
    const run = await runMandate({ mandate, catalog, llm, query });
    if (!run.proposal) return res.json({ run });
    const record = await submitProposal(mandate, ProposalSchema.parse({ ...run.proposal, id: randomUUID() }));
    res.status(201).json({ run, record });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// 2c. A blocked proposal: real products from the same catalog that DO fit the mandate, and a way to
// send one of them back through the Guardian. Only catalog data goes into the new proposal.
app.get("/api/proposals/:id/alternatives", limitShop, async (req, res) => {
  const record = store.records.get(req.params.id);
  if (!record) return res.status(404).json({ error: "Proposal not found." });
  if (record.status !== "blocked") return res.status(409).json({ error: "Alternatives are offered only for blocked proposals." });
  const mandate = store.mandates.get(record.proposal.mandateId);
  if (!mandate) return res.status(404).json({ error: "mandate not found" });
  try {
    res.json({
      source: catalog.source,
      ...(await findAlternatives(catalog, mandate, record.proposal, store.spentThisMonth(mandate.id))),
    });
  } catch (e) {
    res.status(502).json({ error: `The catalog could not be searched: ${e instanceof Error ? e.message : String(e)}` });
  }
});

app.post("/api/proposals/:id/swap", limitShop, async (req, res) => {
  const record = store.records.get(req.params.id);
  if (!record) return res.status(404).json({ error: "Proposal not found." });
  if (record.status !== "blocked") return res.status(409).json({ error: "Only a blocked proposal can be replaced." });
  const mandate = store.mandates.get(record.proposal.mandateId);
  if (!mandate) return res.status(404).json({ error: "mandate not found" });
  const productId = typeof req.body?.productId === "string" ? req.body.productId : "";
  if (!productId) return res.status(400).json({ error: "productId is required" });
  let hit;
  try {
    hit = await catalog.getProduct(productId);
  } catch {
    return res.status(502).json({ error: "The catalog could not be reached." });
  }
  if (!hit || !hit.inStock) return res.status(404).json({ error: "That product is not available in the catalog." });
  const proposal = ProposalSchema.parse({ ...proposalFromHit(mandate, hit, record.proposal), id: randomUUID() });
  res.status(201).json(await submitProposal(mandate, proposal));
});

// PayPal sandbox flows, callbacks and reconciliation.
app.use(createPayPalRouter(store, {
  verifyApproval: (record) => signer.checkRecord(record, store.mandates.get(record.proposal.mandateId)),
  onHumanConfirm: (record) => {
    const mandate = store.mandates.get(record.proposal.mandateId);
    if (mandate) record.receipt = signer.issue(mandate, record, true);
  },
}));

// --- Verifiable trail: receipts, the hash-chained log, the red team and the evidence packet ---

app.get("/api/guardian/public-key", (_req, res) =>
  res.json({ algorithm: "Ed25519", keyId: signer.keyId, publicKeyPem: signer.publicKeyPem, ephemeral: signer.ephemeral }));

app.get("/api/proposals/:id/receipt", (req, res) => {
  const record = store.records.get(req.params.id);
  if (!record) return res.status(404).json({ error: "Proposal not found." });
  if (!record.receipt) return res.status(404).json({ error: "This proposal has no Guardian receipt (it was not approved)." });
  res.json({ receipt: record.receipt, valid: signer.verifySignature(record.receipt) });
});

app.post("/api/receipts/verify", (req, res) => {
  const receipt = req.body?.receipt;
  if (!receipt?.payload || typeof receipt.signature !== "string") return res.status(400).json({ error: "receipt is required" });
  res.json({ valid: signer.verifySignature(receipt), keyId: signer.keyId });
});

app.get("/api/audit-log", (_req, res) => res.json({ ...store.audit.verify(), events: store.audit.events }));
app.get("/api/audit-log/verify", (_req, res) => res.json(store.audit.verify()));

// Hostile proposals against the real Guardian code, on an isolated store. Never touches real records.
app.post("/api/redteam/run", limitRedTeam, async (req, res) => {
  const useAi = req.body?.useAi === true && Boolean(aiReviewer);
  res.json(await runRedTeam({ ai: useAi ? aiReviewer : undefined }));
});

// Everything needed to file a dispute or explain a decision. Needs the demo key: it lists PayPal IDs.
app.get("/api/proposals/:id/evidence", demoKey, (req, res) => {
  const record = store.records.get(req.params.id);
  if (!record) return res.status(404).json({ error: "Proposal not found." });
  const evidence = buildEvidence(record, store, signer);
  if (req.query.format === "md") {
    res.type("text/markdown; charset=utf-8").setHeader("Content-Disposition", `attachment; filename="evidence-${record.proposal.id.slice(0, 8)}.md"`);
    return res.send(evidenceMarkdown(evidence));
  }
  res.json(evidence);
});

// Feed for the AG Grid dashboard.
app.get("/api/records", (_req, res) => {
  res.json([...store.records.values()].map((record) => {
    if (!record.paypal) return record;
    const { approveUrl: _approveUrl, returnState: _returnState, ...paypal } = record.paypal;
    return { ...record, paypal };
  }));
});

// Serve the built dashboard (npm run build) when it exists
const clientDist = path.resolve(process.cwd(), "dist/client");

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nAllow: /\n");
});

if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      maxAge: "1d",
      setHeaders: (res, filePath) => {
        if (filePath.includes("assets")) {
          // Hashed file names never change, so they can be cached for good.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith("index.html")) {
          // The page that names those files must be revalidated, or a redeploy leaves visitors with a broken page.
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/paypal")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });
}

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, "0.0.0.0", () => console.log(`Mandate & Guardian listening on port ${port}`));
}

export { app, store };
