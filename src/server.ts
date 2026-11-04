import "dotenv/config";
import express from "express";
import compression from "compression";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { MandateSchema, ProposalSchema, type AuditRecord, type Mandate, type Proposal } from "./types.js";
import { review } from "./guardian/guardian.js";
import { aiReviewerFromEnv } from "./guardian/ai-reviewer.js";
import { verifyListing } from "./guardian/listing.js";
import { llmFromEnv } from "./guardian/llm.js";
import { catalogFromEnv, type Catalog } from "./channel3/client.js";
import { runMandate } from "./mandate/agent.js";
import { parseMandateText } from "./mandate/parse-mandate.js";
import { Store } from "./store.js";
import { createPayPalRouter } from "./paypal/routes.js";

const app = express();
app.use(compression());
app.use(express.json());

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

app.get("/api/health", (_req, res) => res.json({
  ok: true, catalog: catalog.source, ai: Boolean(llm),
  paypalPlan: process.env.PAYPAL_PLAN,
  demoOvercharge: process.env.ENABLE_DEMO_SCENARIO === "true",
}));

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
  const parsed = MandateSchema.safeParse({ ...req.body, id: randomUUID() });
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  store.mandates.set(parsed.data.id, parsed.data);
  res.status(201).json(parsed.data);
});

app.get("/api/mandates", (_req, res) => res.json([...store.mandates.values()]));

/**
 * Guardian side of a proposal. The price is read from the catalog by productId; a listedPrice sent
 * by the client is always discarded. If the price cannot be verified, the rules block the proposal.
 */
async function submitProposal(mandate: Mandate, proposal: Proposal): Promise<AuditRecord> {
  delete proposal.listedPrice;
  const listing = await verifyListing(catalog, proposal);
  if (listing.ok) proposal.listedPrice = listing.listedPrice;

  const decision = await review(
    mandate,
    proposal,
    { spentThisMonth: store.spentThisMonth(mandate.id), priceVerification: listing },
    aiReviewer,
  );
  const status = decision.verdict === "approve" ? "approved" : decision.verdict === "block" ? "blocked" : "awaiting_human";
  const record: AuditRecord = { proposal, decision, status, updatedAt: "" };
  store.upsert(record);
  return record;
}

// 2. A proposal is submitted. The Guardian reviews it BEFORE any payment.
app.post("/api/proposals", async (req, res) => {
  const parsed = ProposalSchema.safeParse({ ...req.body, id: randomUUID() });
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
    const record = await submitProposal(mandate, ProposalSchema.parse({ ...run.proposal, id: randomUUID() }));
    res.status(201).json({ run, record });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// PayPal sandbox flows, callbacks and reconciliation.
app.use(createPayPalRouter(store));

// Feed for the AG Grid dashboard.
app.get("/api/records", (_req, res) => {
  res.json([...store.records.values()].map((record) => {
    if (!record.paypal) return record;
    const { approveUrl: _approveUrl, returnState: _returnState, ...paypal } = record.paypal;
    return { ...record, paypal };
  }));
});

// Serve static frontend build and Agentic/SEO endpoints
const clientDist = path.resolve(process.cwd(), "dist/client");

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nAllow: /\n");
});

app.get("/llms.txt", (_req, res) => {
  const filePath = path.join(clientDist, "llms.txt");
  if (fs.existsSync(filePath)) {
    return res.type("text/markdown; charset=utf-8").sendFile(filePath);
  }
  res.type("text/markdown; charset=utf-8").send("# Mandate & Guardian\n\n> Trust Layer for AI Shopping Agents.\n\n- [API](/api/health): Health endpoint\n- [Records](/api/records): Audit records\n");
});

app.get(["/ai-catalog.json", "/.well-known/ai-catalog.json"], (_req, res) => {
  const filePath = path.join(clientDist, "ai-catalog.json");
  if (fs.existsSync(filePath)) {
    return res.type("application/json").sendFile(filePath);
  }
  res.json({
    specVersion: "1.0",
    host: {
      displayName: "Mandate & Guardian",
      identifier: "http://localhost:3001",
    },
    entries: [
      {
        identifier: "urn:air:mandateguardian.local:agent:guardian-auditor",
        displayName: "Guardian Auditor Agent",
        type: "application/a2a-agent-card+json",
        description: "Deterministic safety rules engine auditing purchase proposals before payment execution",
        url: "http://localhost:3001/api/records",
      },
      {
        identifier: "urn:air:mandateguardian.local:agent:mandate-buyer",
        displayName: "Mandate Buyer Agent",
        type: "application/a2a-agent-card+json",
        description: "Catalog search and offer evaluation agent connecting to Channel3",
        url: "http://localhost:3001/api/mandates",
      },
    ],
  });
});

if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      maxAge: "1d",
      setHeaders: (res, filePath) => {
        if (filePath.includes("assets")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/paypal")) return next();
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });
}

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(port, "0.0.0.0", () => console.log(`Mandate & Guardian on http://localhost:${port}`));
  server.on("error", (err: any) => {
    if (err.code === "EACCES") {
      const fallbackPort = port === 3000 ? 3001 : port + 1;
      console.warn(`Puerto ${port} restringido (EACCES), iniciando en http://localhost:${fallbackPort}...`);
      app.listen(fallbackPort, "0.0.0.0", () => console.log(`Mandate & Guardian on http://localhost:${fallbackPort}`));
    }
  });
}

export { app, store };
