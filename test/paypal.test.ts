import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Store } from "../src/store.js";
import { createPayPalRouter } from "../src/paypal/routes.js";
import { PayPalClient, requestIdFor, usdValue, type PayPalOrder, type Payment } from "../src/paypal/client.js";
import type { AuditRecord } from "../src/types.js";

describe("PayPal client contract (mock HTTP, no sandbox credentials)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends the payment source, return URLs and stable idempotency keys", async () => {
    const mocked = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/token")) return new Response(JSON.stringify({ access_token: "fake", expires_in: 3600 }));
      return new Response(JSON.stringify({ id: "ORDER1", status: "PAYER_ACTION_REQUIRED" }));
    });
    vi.stubGlobal("fetch", mocked);
    const client = new PayPalClient({ clientId: "fake", clientSecret: "fake", baseUrl: "https://api-m.sandbox.paypal.com" });
    await client.createOrder(10, "USD", "Test", "AUTHORIZE", requestIdFor("create", "p1"), {
      returnUrl: "http://localhost:3000/paypal/return", cancelUrl: "http://localhost:3000/paypal/cancel" });
    await client.authorizeOrder("ORDER1");
    await client.authorizeOrder("ORDER1");
    const posts = mocked.mock.calls.filter(([u]) => !String(u).endsWith("/token"));
    const body = JSON.parse(String(posts[0][1]?.body));
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "10.00" });
    expect(body.payment_source.paypal.experience_context.return_url).toContain("/paypal/return");
    const headers = posts.map(([, init]) => init?.headers as Record<string, string>);
    expect(headers[0]["PayPal-Request-Id"]).not.toBe(headers[1]["PayPal-Request-Id"]);
    expect(headers[1]["PayPal-Request-Id"]).toBe(headers[2]["PayPal-Request-Id"]);
    expect(mocked.mock.calls.filter(([u]) => String(u).endsWith("/token"))).toHaveLength(1);
  });
  it("accepts an empty 204 void response and sends IDs on capture and refund", async () => {
    const mocked = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith("/token")) return new Response(JSON.stringify({ access_token: "fake" }));
      if (String(url).endsWith("/void")) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: "PAYMENT", status: "COMPLETED" }));
    });
    vi.stubGlobal("fetch", mocked);
    const c = new PayPalClient({ clientId: "fake", clientSecret: "fake", baseUrl: "https://api-m.sandbox.paypal.com" });
    await c.voidAuthorization("AUTH");
    await c.captureAuthorization("AUTH");
    await c.refundCapture("CAPTURE");
    for (const [, init] of mocked.mock.calls.slice(1)) {
      expect((init!.headers as Record<string, string>)["PayPal-Request-Id"]).toHaveLength(36);
    }
  });
  it("restricts the kit to USD sandbox and validates precision", () => {
    expect(() => usdValue(10.001, "USD")).toThrow();
    expect(() => usdValue(10, "JPY")).toThrow();
    expect(() => new PayPalClient({ clientId: "x", clientSecret: "x", baseUrl: "https://api-m.paypal.com" })).toThrow();
  });
  it("rejects transaction search windows above 31 days", () => {
    const c = new PayPalClient({ clientId: "fake", clientSecret: "fake", baseUrl: "https://api-m.sandbox.paypal.com" });
    expect(() => c.searchTransactions("2026-01-01", "2026-03-01")).toThrow();
  });
});

describe("PayPal API flow (mock provider)", () => {
  let store: Store, server: Server, origin: string, record: AuditRecord;
  let env: NodeJS.ProcessEnv;
  let order: PayPalOrder, capture: Payment, refund: Payment, authStatus: string;
  let fake: { [key: string]: ReturnType<typeof vi.fn> };
  const key = "local-test-key";
  async function api(path: string, body: unknown = {}, method = "POST", authorized = true) {
    const result = await fetch(origin + path, { method, headers: {
      "Content-Type": "application/json", Connection: "close", ...(authorized ? { Authorization: `Bearer ${key}` } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
    return { status: result.status, body: await result.json() };
  }
  beforeEach(async () => {
    store = new Store();
    store.mandates.set("m1", { id: "m1", goal: "a gift", currency: "USD", maxPerPurchase: 40, maxMonthly: 100, allowedCategories: [] });
    record = { proposal: { id: "p1", mandateId: "m1", title: "Mug", price: 10, listedPrice: 10, currency: "USD", reasoning: "" },
      decision: { proposalId: "p1", verdict: "approve", findings: [], explanation: "All rules pass." }, status: "approved", updatedAt: "" };
    store.upsert(record);
    env = { DEMO_API_KEY: key, APP_BASE_URL: "http://localhost:3000", PAYPAL_PLAN: "A" };
    order = { id: "ORDER1", status: "PAYER_ACTION_REQUIRED", intent: "AUTHORIZE",
      links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1" }],
      purchase_units: [{ amount: { currency_code: "USD", value: "10.00" }, payments: {} }] };
    capture = { id: "CAPTURE1", status: "COMPLETED", amount: { value: "10.00", currency_code: "USD" } };
    refund = { id: "REFUND1", status: "COMPLETED" };
    authStatus = "CREATED";
    fake = {
      createOrder: vi.fn(async (_a, _c, _d, intent) => { order.intent = intent; return structuredClone(order); }),
      getOrder: vi.fn(async () => structuredClone(order)),
      authorizeOrder: vi.fn(async () => {
        order.status = "COMPLETED";
        order.purchase_units![0].payments!.authorizations = [{ id: "AUTH1", status: "CREATED" }];
        return structuredClone(order);
      }),
      captureAuthorization: vi.fn(async () => { order.purchase_units![0].payments!.captures = [capture]; return structuredClone(capture); }),
      captureOrder: vi.fn(async () => { order.status = "COMPLETED"; order.purchase_units![0].payments!.captures = [capture]; return structuredClone(order); }),
      getAuthorization: vi.fn(async () => ({ id: "AUTH1", status: authStatus })),
      voidAuthorization: vi.fn(async () => { authStatus = "VOIDED"; return {}; }),
      getCapture: vi.fn(async () => structuredClone(capture)),
      refundCapture: vi.fn(async () => structuredClone(refund)),
      getRefund: vi.fn(async () => structuredClone(refund)),
      searchTransactions: vi.fn(async () => ({ transaction_details: [] })),
    };
    const app = express();
    app.use(express.json());
    app.use(createPayPalRouter(store, { env, client: fake as unknown as PayPalClient }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
  const endpoint = (action: string) => `/api/proposals/p1/${action}`;
  async function authorize() {
    await api(endpoint("pay"));
    order.status = "APPROVED";
    expect((await api(endpoint("authorize"))).status).toBe(200);
  }
  async function captured() { await authorize(); expect((await api(endpoint("capture"))).status).toBe(200); }

  it("requires demo access and never pays a blocked or unconfirmed proposal", async () => {
    expect((await api(endpoint("pay"), {}, "POST", false)).status).toBe(401);
    record.status = "blocked";
    expect((await api(endpoint("pay"))).status).toBe(409);
    record.status = "awaiting_human";
    expect((await api(endpoint("pay"))).status).toBe(409);
    expect(fake.createOrder).not.toHaveBeenCalled();
  });
  it("creates one order and returns it on repeated pay", async () => {
    const first = await api(endpoint("pay"));
    const second = await api(endpoint("pay"));
    expect(first.body.approveUrl).toContain("sandbox.paypal.com");
    expect(second.body.record.status).toBe("awaiting_paypal");
    expect(fake.createOrder).toHaveBeenCalledTimes(1);
  });
  it("serializes overlapping create requests for the same proposal", async () => {
    let release!: (value: PayPalOrder) => void;
    fake.createOrder.mockImplementationOnce(() => new Promise<PayPalOrder>(r => { release = r; }));
    const first = api(endpoint("pay"));
    await vi.waitFor(() => expect(fake.createOrder).toHaveBeenCalledTimes(1));
    expect((await api(endpoint("pay"))).status).toBe(409);
    release(order);
    expect((await first).status).toBe(200);
  });
  it("requires buyer approval, then authorizes and captures under Plan A", async () => {
    await api(endpoint("pay"));
    expect((await api(endpoint("authorize"))).status).toBe(409);
    order.status = "APPROVED";
    expect((await api(endpoint("authorize"))).body.status).toBe("authorized");
    const result = await api(endpoint("capture"));
    expect(result.body.status).toBe("captured");
    expect(result.body.paypal.charged).toBe(10);
    await api(endpoint("capture"));
    expect(fake.captureAuthorization).toHaveBeenCalledTimes(1);
  });
  it("uses direct order capture for Plan B", async () => {
    env.PAYPAL_PLAN = "B";
    await api(endpoint("pay"));
    order.status = "APPROVED";
    const result = await api(endpoint("capture"));
    expect(result.body.status).toBe("captured");
    expect(fake.captureOrder).toHaveBeenCalledTimes(1);
    expect(fake.authorizeOrder).not.toHaveBeenCalled();
  });
  it("does not capture when the remote order amount differs", async () => {
    await authorize();
    order.purchase_units![0].amount!.value = "999.00";
    expect((await api(endpoint("capture"))).status).toBe(409);
    expect(fake.captureAuthorization).not.toHaveBeenCalled();
  });
  it("rechecks deterministic rules before capture and allows a void", async () => {
    await authorize();
    store.mandates.get("m1")!.maxPerPurchase = 5;
    expect((await api(endpoint("capture"))).status).toBe(409);
    expect((await api(endpoint("void"))).body.status).toBe("voided");
    expect(fake.captureAuthorization).not.toHaveBeenCalled();
  });
  it("does not label a pending capture as completed", async () => {
    await authorize();
    capture.status = "PENDING";
    const result = await api(endpoint("capture"));
    expect(result.status).toBe(202);
    expect(result.body.status).toBe("capture_pending");
    capture.status = "COMPLETED";
    expect((await api(endpoint("reconcile"))).body.status).toBe("reconciled");
  });
  it("recovers a remote capture if its previous local response was lost", async () => {
    await authorize();
    order.purchase_units![0].payments!.captures = [capture];
    expect((await api(endpoint("capture"))).body.paypal.captureId).toBe("CAPTURE1");
    expect(fake.captureAuthorization).not.toHaveBeenCalled();
  });
  it("requires refund confirmation and polls a pending refund instead of posting twice", async () => {
    await captured();
    expect((await api(endpoint("refund"))).status).toBe(400);
    refund.status = "PENDING";
    expect((await api(endpoint("refund"), { confirm: true })).body.status).toBe("refund_pending");
    refund.status = "COMPLETED";
    expect((await api(endpoint("refund"), { confirm: true })).body.status).toBe("refunded");
    expect(fake.refundCapture).toHaveBeenCalledTimes(1);
    expect(fake.getRefund).toHaveBeenCalledTimes(1);
  });
  it("reads reconciliation amounts from PayPal and rejects forged body amounts", async () => {
    await captured();
    expect((await api(endpoint("reconcile"), { charged: 10 })).status).toBe(400);
    capture.amount!.value = "12.00";
    const result = await api(endpoint("reconcile"));
    expect(result.body.status).toBe("alert");
    expect(result.body.paypal.charged).toBe(12);
    expect(result.body.reconciliation.source).toBe("paypal_capture");
  });
  it("labels simulated overcharges and preserves the actual captured amount", async () => {
    await captured();
    expect((await api(endpoint("demo-overcharge"), { charged: 27.5 })).status).toBe(403);
    env.ENABLE_DEMO_SCENARIO = "true";
    const result = await api(endpoint("demo-overcharge"), { charged: 27.5 });
    expect(result.body.paypal.charged).toBe(10);
    expect(result.body.demo).toEqual({ simulated: true, charged: 27.5 });
    expect(result.body.reconciliation.source).toBe("simulated");
    const refunded = await api(endpoint("refund"), { confirm: true });
    expect(refunded.body.status).toBe("refunded");
    expect(fake.refundCapture.mock.calls[0][1]).toBeUndefined();
  });
  it("counts approved reservations and does not shift spending dates on later updates", () => {
    expect(store.spentThisMonth("m1")).toBe(10);
    expect(store.spentThisMonth("m1", new Date(), "p1")).toBe(0);
    record.createdAt = "2020-01-01T00:00:00.000Z";
    store.upsert(record);
    expect(store.spentThisMonth("m1")).toBe(0);
    record.createdAt = new Date().toISOString();
    record.status = "refunded";
    expect(store.spentThisMonth("m1")).toBe(0);
  });
});
