import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { verifyPlanA } from "../scripts/verify-plan-a.js";
import type { PayPalOrder, Payment } from "../src/paypal/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("runs two complete Plan A rounds through the app with PayPal HTTP mocked", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_API_KEY", "integration-test-key");
  vi.stubEnv("PAYPAL_PLAN", "A");
  vi.stubEnv("PAYPAL_CLIENT_ID", "fake");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "fake");
  vi.stubEnv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com");
  vi.stubEnv("CHANNEL3_API_KEY", "");
  vi.stubEnv("AI_API_KEY", "");
  vi.stubEnv("ENABLE_DEMO_SCENARIO", "true");

  const realFetch = globalThis.fetch;
  const orders = new Map<string, PayPalOrder>();
  const authorizations = new Map<string, Payment>();
  const captures = new Map<string, Payment>();
  const requestIds = new Set<string>();
  let refunds = 0;
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === "127.0.0.1") return realFetch(input, init);
    expect(url.origin).toBe("https://api-m.sandbox.paypal.com");
    const path = url.pathname;
    if (path === "/v1/oauth2/token") return Response.json({ access_token: "fake" });
    if (init?.method === "POST") {
      const requestId = new Headers(init.headers).get("PayPal-Request-Id");
      expect(requestId).toHaveLength(36);
      expect(requestIds.has(requestId!)).toBe(false);
      requestIds.add(requestId!);
    }
    if (path === "/v2/checkout/orders") {
      const id = `ORDER-${orders.size + 1}`;
      const body = JSON.parse(String(init?.body));
      const order: PayPalOrder = {
        id, status: "PAYER_ACTION_REQUIRED", intent: body.intent, purchase_units: body.purchase_units,
        links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }],
      };
      orders.set(id, order);
      return Response.json(order);
    }
    const [, , , resource, id, action] = path.split("/");
    if (resource === "orders") {
      const order = orders.get(id)!;
      if (action === "authorize") {
        const auth: Payment = { id: `AUTH-${id}`, status: "CREATED", amount: order.purchase_units![0].amount };
        authorizations.set(auth.id, auth);
        order.purchase_units![0].payments = { authorizations: [auth] };
        order.status = "COMPLETED";
      }
      return Response.json(order);
    }
    if (resource === "authorizations") {
      const auth = authorizations.get(id)!;
      if (action === "capture") {
        const capture: Payment = { id: `CAPTURE-${id}`, status: "COMPLETED", amount: auth.amount };
        captures.set(capture.id, capture);
        return Response.json(capture);
      }
      if (action === "void") {
        auth.status = "VOIDED";
        return new Response(null, { status: 204 });
      }
      return Response.json(auth);
    }
    if (resource === "captures") {
      const capture = captures.get(id)!;
      if (action === "refund") {
        expect(JSON.parse(String(init?.body))).not.toHaveProperty("amount");
        return Response.json({ id: `REFUND-${++refunds}`, status: "COMPLETED", amount: capture.amount });
      }
      return Response.json(capture);
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  const { app } = await import("../src/server.js");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv("APP_BASE_URL", origin);
  const evidence = new Map<number, object>();
  try {
    await verifyPlanA(origin, "integration-test-key", "ceramic mug gift", async (question) => {
      const orderId = question.match(/token=(ORDER-\d+)/)?.[1];
      if (orderId) {
        orders.get(orderId)!.status = "APPROVED";
        return "APPROVED";
      }
      expect(question).toContain("Type REFUND");
      return "REFUND";
    }, async (round, result) => { evidence.set(round, structuredClone(result)); });
    expect([...evidence.values()]).toHaveLength(2);
    for (const result of evidence.values()) {
      expect(result).toMatchObject({
        completed: true, catalog: { source: "demo" },
        blocked: { paymentHttpStatus: 409 }, refund: { status: "refunded" }, void: { status: "voided" },
      });
      expect(JSON.stringify(result)).not.toMatch(/approveUrl|returnState/);
    }
    expect(orders.size).toBe(4);
    expect(captures.size).toBe(2);
    expect(refunds).toBe(2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
