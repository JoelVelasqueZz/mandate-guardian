import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Store } from "../store.js";
import type { AuditRecord } from "../types.js";
import { runRules } from "../guardian/rules.js";
import { reconcile } from "../guardian/reconcile.js";
import { secondReading, type SdkReader } from "./sdk-reader.js";
import { paypalFromEnv, PayPalError, requestIdFor, approvalUrl, firstAuthorization, firstCapture,
  type PayPalClient, type PayPalOrder, type Payment } from "./client.js";

class FlowError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function requireFlow(condition: unknown, message: string, status = 409): asserts condition {
  if (!condition) throw new FlowError(status, message);
}
function baseUrl(env: NodeJS.ProcessEnv) {
  const origin = env.APP_BASE_URL || env.RENDER_EXTERNAL_URL || "http://localhost:3000";
  requireFlow(URL.canParse(origin), "Set APP_BASE_URL to a valid app origin.", 503);
  const url = new URL(origin);
  requireFlow(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)),
    "APP_BASE_URL must use HTTPS, or HTTP on localhost.", 503);
  return url.origin;
}
/** Requires `Authorization: Bearer <DEMO_API_KEY>`. Answers 503 when the server has no key set. */
export function demoKeyGate(env: NodeJS.ProcessEnv) {
  return function gate(req: Request, res: Response, next: NextFunction) {
    if (!env.DEMO_API_KEY) return res.status(503).json({ error: "Set DEMO_API_KEY on the server before testing payments." });
    const supplied = Buffer.from(req.header("Authorization")?.replace(/^Bearer /, "") ?? "");
    const expected = Buffer.from(env.DEMO_API_KEY);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(401).json({ error: "Demo access key required." });
    }
    next();
  };
}

export function createPayPalRouter(store: Store, options: {
  env?: NodeJS.ProcessEnv;
  client?: PayPalClient;
  /** Returns the reason a proposal may not be paid (for example a missing Guardian receipt), or undefined. */
  verifyApproval?: (record: AuditRecord) => string | undefined;
  /** Called when a human confirms a proposal, before it becomes approved (the server issues the receipt here). */
  onHumanConfirm?: (record: AuditRecord) => void;
  /** Reads a capture a second time through PayPal's official SDK, so reconciliation can compare two readings. */
  sdkReader?: SdkReader;
} = {}) {
  const env = options.env ?? process.env;
  let cached = options.client;
  const client = () => cached ??= paypalFromEnv(env);
  const router = Router();
  const busy = new Set<string>();
  const gate = demoKeyGate(env);
  function sendError(res: Response, e: unknown) {
    if (e instanceof FlowError) return res.status(e.status).json({ error: e.message });
    if (e instanceof PayPalError) return res.status(502).json({
      error: e.message, paypalStatus: e.status, debugId: e.debugId,
      details: (e.response as { details?: { issue?: string; description?: string }[] })?.details,
    });
    return res.status(502).json({ error: e instanceof Error ? e.message : "Payment operation failed." });
  }
  type Handler = (req: Request, res: Response, record: AuditRecord) => Promise<unknown>;
  function withRecord(fn: Handler, exclusive = true) {
    return async (req: Request, res: Response) => {
      const id = req.params.id;
      let acquired = false;
      try {
        const record = store.records.get(id);
        requireFlow(record, "Proposal not found.", 404);
        requireFlow(!exclusive || !busy.has(id), "Another payment operation is running. Retry shortly.");
        if (exclusive) { busy.add(id); acquired = true; }
        await fn(req, res, record);
      } catch (e) { sendError(res, e); }
      finally { if (acquired) busy.delete(id); }
    };
  }
  function recheck(record: AuditRecord) {
    const mandate = store.mandates.get(record.proposal.mandateId);
    requireFlow(mandate, "Mandate not found.", 404);
    const failed = runRules(mandate, record.proposal, {
      spentThisMonth: store.spentThisMonth(mandate.id, new Date(), record.proposal.id),
    }).filter(f => !f.ok);
    requireFlow(!failed.length, `Guardian rules failed: ${failed.map(f => f.rule).join(", ")}. Void an existing authorization instead of capturing.`);
  }
  function verifyOrder(order: PayPalOrder, record: AuditRecord) {
    requireFlow(order.id === record.paypal?.orderId, "Unexpected PayPal order.");
    requireFlow(order.intent === record.paypal?.intent, "Unexpected order intent.");
    const amount = order.purchase_units?.[0]?.amount;
    requireFlow(order.purchase_units?.length === 1 && amount?.currency_code === record.proposal.currency &&
      Math.round(Number(amount.value) * 100) === Math.round(record.proposal.price * 100),
    "PayPal order amount or currency differs from the approved proposal.");
  }
  function saveCapture(record: AuditRecord, capture: Payment) {
    requireFlow(capture.id && capture.amount && Number.isFinite(Number(capture.amount.value)), "Capture response is missing its ID or amount.", 502);
    record.paypal = { ...record.paypal, captureId: capture.id, captureStatus: capture.status,
      capturedAt: capture.create_time ?? record.paypal?.capturedAt ?? new Date().toISOString(),
      charged: Number(capture.amount.value), chargedCurrency: capture.amount.currency_code };
    if (capture.status === "COMPLETED") {
      const amountMatches = Math.round(record.paypal.charged! * 100) === Math.round(record.proposal.price * 100);
      record.status = amountMatches && capture.amount.currency_code === record.proposal.currency ? "captured" : "alert";
    } else {
      record.status = capture.status === "PENDING" ? "capture_pending" : "alert";
    }
    store.upsert(record);
  }

  // A GET return page never authorizes/captures/refunds a payment.
  router.get("/paypal/return", (req, res) => {
    const proposalId = typeof req.query.proposalId === "string" ? req.query.proposalId : undefined;
    if (proposalId) {
      const record = store.records.get(proposalId);
      if (!record || req.query.token !== record.paypal?.orderId || req.query.state !== record.paypal?.returnState) {
        return res.status(400).type("text").send("Invalid PayPal return. Check the order in the app.");
      }
    }
    res.set("Cache-Control", "no-store").type("html").send("<!doctype html><html lang='en'><meta charset='utf-8'><title>PayPal Sandbox</title><h1>Return received</h1><p>Buyer approval still needs to be verified.</p><p><a href='/?checkout=returned'>Return to the dashboard</a></p></html>");
  });
  router.get("/paypal/cancel", (_req, res) => res.type("html").send(
    "<!doctype html><html lang='en'><meta charset='utf-8'><title>PayPal Sandbox</title><h1>Checkout cancelled</h1><p>You can reopen checkout from your proposal.</p><p><a href='/?checkout=cancelled'>Return to the dashboard</a></p></html>"));

  router.post("/api/proposals/:id/confirm", gate, withRecord(async (_req, res, record) => {
    requireFlow(record.status === "awaiting_human", `Cannot confirm a proposal in status ${record.status}.`);
    record.status = "approved";
    options.onHumanConfirm?.(record);
    store.upsert(record);
    res.json(record);
  }));

  router.post("/api/proposals/:id/pay", gate, withRecord(async (_req, res, record) => {
    requireFlow(["approved", "awaiting_paypal"].includes(record.status), `Cannot pay a proposal in status ${record.status}.`);
    if (record.paypal?.orderId) return res.json({ record, approveUrl: record.paypal.approveUrl });
    // No Guardian receipt, or a proposal edited after approval, means no PayPal order.
    const unapproved = options.verifyApproval?.(record);
    requireFlow(!unapproved, unapproved ?? "", 403);
    recheck(record);
    requireFlow(env.PAYPAL_PLAN === "A" || env.PAYPAL_PLAN === "B", "Set PAYPAL_PLAN to A or B after the sandbox decision.", 503);
    const intent = env.PAYPAL_PLAN === "A" ? "AUTHORIZE" : "CAPTURE";
    const origin = baseUrl(env);
    // Store pending state BEFORE the network call. Retries reuse both URLs and request ID.
    record.paypal = { ...record.paypal, intent,
      returnState: record.paypal?.returnState ?? randomUUID() };
    record.status = "awaiting_paypal";
    store.upsert(record);
    const params = new URLSearchParams({ proposalId: record.proposal.id, state: record.paypal.returnState! });
    const order = await client().createOrder(record.proposal.price, record.proposal.currency, record.proposal.title,
      intent, requestIdFor("create", record.proposal.id), {
        returnUrl: `${origin}/paypal/return?${params}`, cancelUrl: `${origin}/paypal/cancel`,
      });
    requireFlow(order.id && approvalUrl(order), "PayPal did not return an order ID and approval link.", 502);
    record.paypal = { ...record.paypal, orderId: order.id, approveUrl: approvalUrl(order) };
    store.upsert(record);
    res.json({ record, approveUrl: record.paypal.approveUrl });
  }));
  router.get("/api/proposals/:id/paypal", gate, withRecord(async (_req, res, record) => {
    requireFlow(record.paypal?.orderId, "No order exists.");
    const { id, status, intent } = await client().getOrder(record.paypal.orderId);
    res.json({ record, order: { id, status, intent } });
  }, false));
  router.post("/api/proposals/:id/authorize", gate, withRecord(async (_req, res, record) => {
    if (record.status === "authorized") return res.json(record);
    requireFlow(record.status === "awaiting_paypal" && record.paypal?.orderId && record.paypal.intent === "AUTHORIZE",
      "Plan A needs a buyer-approved AUTHORIZE order.");
    recheck(record);
    let order = await client().getOrder(record.paypal.orderId);
    verifyOrder(order, record);
    let authorization = firstAuthorization(order);
    if (!authorization) {
      requireFlow(order.status === "APPROVED", `Buyer must approve first. PayPal status: ${order.status}.`);
      order = await client().authorizeOrder(order.id);
      authorization = firstAuthorization(order);
    }
    requireFlow(authorization?.id && authorization.status === "CREATED", "Authorization is not ready. Inspect the PayPal response.", 502);
    record.paypal.authorizationId = authorization.id;
    record.status = "authorized";
    store.upsert(record);
    res.json(record);
  }));
  router.post("/api/proposals/:id/capture", gate, withRecord(async (_req, res, record) => {
    if (record.paypal?.captureId) return res.json(record);
    requireFlow(["authorized", "awaiting_paypal"].includes(record.status) && record.paypal?.orderId, "No order is ready for capture.");
    const order = await client().getOrder(record.paypal.orderId);
    verifyOrder(order, record);
    // Recover a completed remote call whose local response was lost.
    let capture = firstCapture(order);
    if (!capture) {
      recheck(record);
      if (record.paypal.intent === "AUTHORIZE") {
        requireFlow(record.status === "authorized" && record.paypal.authorizationId, "Authorize the order first.");
        capture = await client().captureAuthorization(record.paypal.authorizationId);
      } else {
        requireFlow(order.status === "APPROVED", `Buyer must approve first. PayPal status: ${order.status}.`);
        capture = firstCapture(await client().captureOrder(order.id));
      }
    }
    requireFlow(capture, "No capture returned.", 502);
    saveCapture(record, capture);
    res.status(record.status === "capture_pending" ? 202 : 200).json(record);
  }));
  router.post("/api/proposals/:id/void", gate, withRecord(async (_req, res, record) => {
    if (record.status === "voided") return res.json(record);
    requireFlow(record.status === "authorized" && record.paypal?.authorizationId && !record.paypal.captureId,
      "Only an uncaptured authorization can be voided.");
    const id = record.paypal.authorizationId;
    const before = await client().getAuthorization(id);
    if (before.status !== "VOIDED") await client().voidAuthorization(id);
    const after = await client().getAuthorization(id);
    requireFlow(after.status === "VOIDED", `Authorization status is ${after.status}; not marked voided.`, 502);
    record.status = "voided";
    store.upsert(record);
    res.json(record);
  }));
  router.post("/api/proposals/:id/reconcile", gate, withRecord(async (req, res, record) => {
    requireFlow(req.body?.charged === undefined, "Real reconciliation reads PayPal. Use demo-overcharge for a labeled simulation.", 400);
    requireFlow(record.paypal?.captureId && ["captured", "capture_pending", "alert", "reconciled"].includes(record.status), "No eligible capture to reconcile.");
    const capture = await client().getCapture(record.paypal.captureId);
    saveCapture(record, capture);
    if (capture.status === "PENDING") return res.status(202).json(record);
    requireFlow(capture.status === "COMPLETED", `Capture is ${capture.status}, not COMPLETED.`);
    const currencyMatches = capture.amount?.currency_code === record.proposal.currency;
    record.reconciliation = currencyMatches ? { ...reconcile(record), source: "paypal_capture" } : {
      match: false, detail: "PayPal currency differs from the approved currency.", source: "paypal_capture" };
    // A second reading of the same capture through PayPal's official SDK. If the two disagree, alert.
    if (options.sdkReader) {
      const crossCheck = await secondReading(options.sdkReader, record);
      record.reconciliation.crossCheck = crossCheck;
      if (crossCheck.agrees === false) {
        record.reconciliation.match = false;
        record.reconciliation.detail = `${record.reconciliation.detail} ${crossCheck.detail}`;
      }
    }
    record.status = record.reconciliation.match ? "reconciled" : "alert";
    store.upsert(record);
    res.json(record);
  }));
  router.post("/api/proposals/:id/demo-overcharge", gate, withRecord(async (req, res, record) => {
    requireFlow(env.ENABLE_DEMO_SCENARIO === "true", "Demo scenario is disabled.", 403);
    requireFlow(record.paypal?.captureStatus === "COMPLETED" && ["captured", "reconciled", "alert"].includes(record.status), "Complete a capture first.");
    const parsed = z.object({ charged: z.number().finite().positive() }).safeParse(req.body);
    requireFlow(parsed.success, "Supply a positive charged number.", 400);
    requireFlow(parsed.data.charged > (record.paypal.charged ?? 0), "Demo amount must exceed the actual capture.", 400);
    record.demo = { simulated: true, charged: parsed.data.charged };
    record.reconciliation = { ...reconcile({ ...record, paypal: { ...record.paypal, charged: parsed.data.charged } }),
      source: "simulated", detail: `SIMULATED OVERCHARGE. ${reconcile({ ...record, paypal: { ...record.paypal, charged: parsed.data.charged } }).detail}` };
    record.status = "alert";
    store.upsert(record);
    res.json(record);
  }));
  router.post("/api/proposals/:id/refund", gate, withRecord(async (req, res, record) => {
    requireFlow(req.body?.confirm === true, "Explicit human confirmation is required: {confirm:true}.", 400);
    if (record.status === "refunded") return res.json(record);
    requireFlow(record.paypal?.captureId && record.paypal.captureStatus === "COMPLETED" &&
      ["captured", "reconciled", "alert", "refund_pending"].includes(record.status), "No completed capture available to refund.");
    // The MVP performs ONE full refund; it never refunds a simulated excess amount.
    const refund = record.paypal.refundId
      ? await client().getRefund(record.paypal.refundId)
      : await client().refundCapture(record.paypal.captureId, undefined, "Human-approved sandbox demo refund.");
    requireFlow(refund.id, "No refund ID returned.", 502);
    record.paypal.refundId = refund.id;
    record.paypal.refundStatus = refund.status;
    record.status = refund.status === "COMPLETED" ? "refunded" : refund.status === "PENDING" ? "refund_pending" : "alert";
    store.upsert(record);
    res.status(record.status === "refund_pending" ? 202 : 200).json(record);
  }));
  router.get("/api/paypal/transactions", gate, async (req, res) => {
    try {
      const end = typeof req.query.end === "string" ? req.query.end : new Date().toISOString();
      const start = typeof req.query.start === "string" ? req.query.start : new Date(Date.now() - 86_400_000).toISOString();
      const id = typeof req.query.transactionId === "string" ? req.query.transactionId : undefined;
      res.json(await client().searchTransactions(start, end, id, Number(req.query.page ?? 1)));
    } catch (e) { sendError(res, e); }
  });
  return router;
}
