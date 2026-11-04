import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import type { AuditRecord, Mandate } from "../src/types.js";

type Checkout = { record: AuditRecord; approveUrl: string };
type BuyerOrder = { order: { id: string; status: string; intent: string } };
type Health = { ok: boolean; catalog: "demo" | "channel3"; ai: boolean; paypalPlan: string; demoOvercharge: boolean };

function audit(record: AuditRecord) {
  if (!record.paypal) return record;
  const { approveUrl: _approveUrl, returnState: _returnState, ...paypal } = record.paypal;
  return { ...record, paypal };
}

export async function verifyPlanA(
  origin: string,
  key: string,
  query: string,
  ask: (question: string) => Promise<string>,
  save: (round: number, evidence: object) => Promise<void>,
) {
  const base = new URL(origin);
  assert(base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)),
    "Use your HTTPS app URL or HTTP on localhost.");
  assert(!base.username && !base.password, "Use an app URL without credentials.");
  assert(key, "Set DEMO_API_KEY in your local environment.");

  async function request<T>(path: string, body?: object, expected: number | number[] = 200): Promise<T> {
    const response = await fetch(base.origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json() as T & { error?: string };
    assert((Array.isArray(expected) ? expected : [expected]).includes(response.status),
      `${path} returned HTTP ${response.status}; expected ${expected}. ${data.error ?? ""}`.trim());
    return data;
  }

  const health = await request<Health>("/api/health");
  assert(health.ok && health.paypalPlan === "A" && health.demoOvercharge,
    "Start the app with PAYPAL_PLAN=A and ENABLE_DEMO_SCENARIO=true.");
  const endpoint = (record: AuditRecord, action: string) => `/api/proposals/${record.proposal.id}/${action}`;

  async function settle(record: AuditRecord, action: "reconcile" | "refund", body: object) {
    for (let attempt = 0; attempt < 8; attempt++) {
      record = await request<AuditRecord>(endpoint(record, action), body, [200, 202]);
      if (record.status !== "capture_pending" && record.status !== "refund_pending") return record;
      await delay(4_000);
    }
    throw new Error(`PayPal is still pending for proposal ${record.proposal.id}. Check this same record before retrying.`);
  }

  async function approveAndAuthorize(record: AuditRecord, evidence: Record<string, unknown>, label: string, checkpoint: () => Promise<void>) {
    if (record.status === "awaiting_human") {
      assert.equal((await ask(`Guardian asks for confirmation: ${record.decision?.explanation}\nType CONFIRM to continue: `)).trim(), "CONFIRM");
      record = await request<AuditRecord>(endpoint(record, "confirm"), {});
    }
    assert.equal(record.status, "approved", record.decision?.explanation);
    const checkout = await request<Checkout>(endpoint(record, "pay"), {});
    evidence[label] = audit(checkout.record);
    await checkpoint();

    const orderId = checkout.record.paypal?.orderId;
    assert(orderId, "Checkout must include an order ID.");
    assert.equal(checkout.record.paypal?.intent, "AUTHORIZE");
    const approval = new URL(checkout.approveUrl);
    assert(approval.protocol === "https:" && ["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(approval.hostname),
      "Expected a PayPal Sandbox checkout URL.");
    const retry = await request<Checkout>(endpoint(record, "pay"), {});
    assert.equal(retry.record.paypal?.orderId, orderId, "Retry must reuse the same order.");

    assert.equal((await ask(`\nOpen this Sandbox URL as the Personal buyer:\n${approval.href}\nAfter approval and return to your app, type APPROVED: `)).trim(),
      "APPROVED");
    const { order } = await request<BuyerOrder>(endpoint(record, "paypal"));
    assert.equal(order.id, orderId);
    assert.equal(order.status, "APPROVED", "PayPal must confirm buyer approval before authorizing.");
    assert.equal(order.intent, "AUTHORIZE");
    evidence[`${label}BuyerApproval`] = { id: order.id, status: order.status, retryOrderId: retry.record.paypal?.orderId };
    const authorization = await request<AuditRecord>(endpoint(record, "authorize"), {});
    assert.equal(authorization.status, "authorized");
    assert(authorization.paypal?.authorizationId, "Expected an authorization ID.");
    evidence[label] = audit(authorization);
    await checkpoint();
    return authorization;
  }

  for (const round of [1, 2]) {
    const evidence: Record<string, unknown> = { round, health, completed: false, startedAt: new Date().toISOString() };
    const checkpoint = () => save(round, evidence);
    const mandate = await request<Mandate>("/api/mandates", {
      goal: query, currency: "USD", maxPerPurchase: 40, maxMonthly: 100,
    }, 201);
    evidence.mandate = mandate;

    const { record: proposed, run } = await request<{ record?: AuditRecord; run: { source: string; usedAi: boolean } }>(
      `/api/mandates/${mandate.id}/shop`, { query }, 201,
    );
    assert(proposed?.proposal.productId, "Mandate must return a verified catalog product.");
    evidence.proposal = audit(proposed);
    evidence.catalog = { source: run.source, usedAi: run.usedAi };
    await checkpoint();

    const blocked = await request<AuditRecord>("/api/proposals", {
      ...proposed.proposal, price: 55,
    }, 201);
    assert.equal(blocked.status, "blocked");
    await request(endpoint(blocked, "pay"), {}, 409);
    evidence.blocked = { record: audit(blocked), paymentHttpStatus: 409 };
    await checkpoint();

    const authorized = await approveAndAuthorize(proposed, evidence, "checkout", checkpoint);
    const captured = await request<AuditRecord>(endpoint(authorized, "capture"), {}, [200, 202]);
    evidence.capture = audit(captured);
    await checkpoint();
    assert(["captured", "capture_pending"].includes(captured.status), "PayPal capture needs review.");
    const reconciled = await settle(captured, "reconcile", {});
    assert.equal(reconciled.status, "reconciled");
    assert.equal(reconciled.reconciliation?.source, "paypal_capture");
    assert.equal(reconciled.paypal?.charged, proposed.proposal.price);
    assert.equal(reconciled.paypal?.chargedCurrency, proposed.proposal.currency);
    evidence.reconciliation = audit(reconciled);

    const simulatedAmount = Number((proposed.proposal.price + 8.5).toFixed(2));
    const alert = await request<AuditRecord>(endpoint(authorized, "demo-overcharge"), { charged: simulatedAmount });
    assert.equal(alert.status, "alert");
    assert.equal(alert.reconciliation?.source, "simulated");
    assert.equal(alert.demo?.charged, simulatedAmount);
    assert.equal(alert.paypal?.charged, reconciled.paypal?.charged);
    evidence.simulation = audit(alert);
    await checkpoint();

    assert.equal((await ask(`Type REFUND to refund the original ${reconciled.paypal.charged} USD Sandbox capture: `)).trim(), "REFUND");
    const refundStarted = await request<AuditRecord>(endpoint(authorized, "refund"), { confirm: true }, [200, 202]);
    evidence.refund = audit(refundStarted);
    await checkpoint();
    const refund = refundStarted.status === "refund_pending"
      ? await settle(refundStarted, "refund", { confirm: true })
      : refundStarted;
    assert.equal(refund.status, "refunded");
    evidence.refund = audit(refund);
    assert(refund.paypal?.refundId, "Expected a refund ID.");

    const forVoid = await request<AuditRecord>("/api/proposals", proposed.proposal, 201);
    const voidAuthorization = await approveAndAuthorize(forVoid, evidence, "voidCheckout", checkpoint);
    const voided = await request<AuditRecord>(endpoint(voidAuthorization, "void"), {});
    assert.equal(voided.status, "voided");
    assert(!voided.paypal?.captureId, "A void must use a separate, uncaptured authorization.");
    evidence.void = audit(voided);
    const records = await request<AuditRecord[]>("/api/records");
    const roundIds = new Set([authorized.proposal.id, blocked.proposal.id, voided.proposal.id]);
    const rows = records.filter((record) => roundIds.has(record.proposal.id));
    assert.deepEqual(rows.map((row) => row.status).sort(), ["blocked", "refunded", "voided"]);
    assert(rows.every((row) => !row.paypal?.approveUrl && !row.paypal?.returnState), "Audit feed must hide checkout secrets.");
    evidence.auditRecords = rows;
    evidence.completed = true;
    await checkpoint();
    stdout.write(`Round ${round}: approved, blocked, captured, reconciled, refunded and voided.\n`);
  }
}

async function main() {
  if (!stdin.isTTY) throw new Error("Run in a terminal for Sandbox buyer and refund confirmation.");
  const origin = process.argv[2] ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const query = process.argv[3] ?? "ceramic mug gift";
  const folder = join(".local", "edison-paypal", "api");
  const runId = randomUUID().slice(0, 8);
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    await mkdir(folder, { recursive: true });
    stdout.write(`Saving evidence to ${folder}/plan-a-${runId}-*.json.\n`);
    await verifyPlanA(origin, process.env.DEMO_API_KEY ?? "", query, (prompt) => reader.question(prompt),
      (round, evidence) => writeFile(join(folder, `plan-a-${runId}-${round}.json`), JSON.stringify(evidence, null, 2) + "\n"));
  } finally {
    reader.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    process.stderr.write(`${error.message}\nCheck /api/records and the saved evidence before retrying a payment.\n`);
    process.exitCode = 1;
  });
}
