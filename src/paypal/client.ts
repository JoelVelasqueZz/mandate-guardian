/**
 * Minimal PayPal REST client (Sandbox). Uses fetch, no SDK, so every call is visible and testable.
 * Docs: https://developer.paypal.com/api/rest/
 *
 * IMPORTANT: for PayPal-wallet payments the BUYER must approve the order (approve link)
 * before authorize/capture. Verify in the sandbox how this fits an agent flow (day-1 task).
 */
export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export class PayPalClient {
  private token?: { value: string; expiresAt: number };

  constructor(private cfg: PayPalConfig) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await fetch(`${this.cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !data.access_token) throw new Error(`PayPal auth failed: ${res.status} ${JSON.stringify(data)}`);
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 300) * 1000 };
    return this.token.value;
  }

  private async call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}), // idempotency
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`PayPal ${method} ${path} -> ${res.status}: ${text}`);
    return data as T;
  }

  /** intent AUTHORIZE holds the funds without charging (capture or void later). */
  createOrder(amount: number, currency: string, description: string, intent: "AUTHORIZE" | "CAPTURE" = "AUTHORIZE", requestId?: string) {
    return this.call<{ id: string; status: string; links: { rel: string; href: string }[] }>(
      "POST",
      "/v2/checkout/orders",
      {
        intent,
        purchase_units: [{ description, amount: { currency_code: currency, value: amount.toFixed(2) } }],
      },
      requestId,
    );
  }

  authorizeOrder(orderId: string) {
    return this.call<{ id: string; status: string; purchase_units: { payments: { authorizations: { id: string }[] } }[] }>(
      "POST",
      `/v2/checkout/orders/${orderId}/authorize`,
    );
  }

  captureOrder(orderId: string) {
    return this.call<{ id: string; status: string; purchase_units: { payments: { captures: { id: string; amount: { value: string } }[] } }[] }>(
      "POST",
      `/v2/checkout/orders/${orderId}/capture`,
    );
  }

  captureAuthorization(authorizationId: string, requestId?: string) {
    return this.call<{ id: string; status: string }>("POST", `/v2/payments/authorizations/${authorizationId}/capture`, { final_capture: true }, requestId);
  }

  voidAuthorization(authorizationId: string) {
    return this.call<unknown>("POST", `/v2/payments/authorizations/${authorizationId}/void`);
  }

  /** Omit amount for a full refund. */
  refundCapture(captureId: string, amount?: { value: number; currency: string }, note?: string, requestId?: string) {
    return this.call<{ id: string; status: string }>(
      "POST",
      `/v2/payments/captures/${captureId}/refund`,
      {
        ...(amount ? { amount: { value: amount.value.toFixed(2), currency_code: amount.currency } } : {}),
        ...(note ? { note_to_payer: note } : {}),
      },
      requestId,
    );
  }

  getOrder(orderId: string) {
    return this.call<unknown>("GET", `/v2/checkout/orders/${orderId}`);
  }
}

export function paypalFromEnv(env = process.env): PayPalClient {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env");
  return new PayPalClient({ clientId, clientSecret, baseUrl: env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com" });
}
