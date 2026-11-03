import { createHash, randomUUID } from "node:crypto";

export interface Money { currency_code: string; value: string }
export interface Link { rel: string; href: string }
export interface Payment {
  id: string;
  status: string;
  amount?: Money;
  create_time?: string;
}
export interface PayPalOrder {
  id: string;
  status: string;
  intent?: "AUTHORIZE" | "CAPTURE";
  links?: Link[];
  purchase_units?: {
    amount?: Money;
    payments?: { authorizations?: Payment[]; captures?: Payment[] };
  }[];
}
export interface TransactionPage {
  transaction_details?: { transaction_info?: {
    transaction_id?: string;
    transaction_status?: string;
    transaction_amount?: Money;
    transaction_event_code?: string;
  } }[];
  total_pages?: number;
  page?: number;
  last_refreshed_datetime?: string;
}
export interface PayPalConfig { clientId: string; clientSecret: string; baseUrl: string }
export interface CheckoutUrls { returnUrl: string; cancelUrl: string }

/** A stable UUID-length key for retries of ONE operation on ONE resource. */
export function requestIdFor(operation: string, resource: string): string {
  const hex = createHash("sha256").update(`${operation}:${resource}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function approvalUrl(order: PayPalOrder): string | undefined {
  return order.links?.find(l => l.rel === "payer-action" || l.rel === "approve")?.href;
}
export function firstAuthorization(order: PayPalOrder): Payment | undefined {
  return order.purchase_units?.flatMap(u => u.payments?.authorizations ?? [])[0];
}
export function firstCapture(order: PayPalOrder): Payment | undefined {
  return order.purchase_units?.flatMap(u => u.payments?.captures ?? [])[0];
}
/** This kit deliberately supports the team's USD sandbox demo only. */
export function usdValue(amount: number, currency: string): string {
  if (currency !== "USD" || !Number.isFinite(amount) || amount <= 0 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new Error("Use a positive USD amount with at most two decimal places.");
  }
  return amount.toFixed(2);
}

export class PayPalError extends Error {
  constructor(public status: number, public response: unknown, public debugId?: string) {
    const data = response as { name?: string; message?: string };
    super(`PayPal ${status}: ${data?.name ?? "API_ERROR"} ${data?.message ?? ""}`);
  }
}

/** Sandbox-only, server-side REST client. No credentials or tokens go to the UI. */
export class PayPalClient {
  private token?: { value: string; expiresAt: number };
  private base: string;
  constructor(private cfg: PayPalConfig) {
    this.base = cfg.baseUrl.replace(/\/$/, "");
    if (this.base !== "https://api-m.sandbox.paypal.com") {
      throw new Error("This Edison kit is sandbox-only. PAYPAL_BASE_URL must use api-m.sandbox.paypal.com.");
    }
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const data = await res.json() as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) {
      // Do not retain OAuth responses in evidence files.
      throw new Error(`PayPal OAuth failed (${res.status} ${data.error ?? "missing token"}). Check sandbox app credentials.`);
    }
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 300) * 1000 };
    return this.token.value;
  }
  private async call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method, signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await res.text();
    let data: unknown;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 500) }; }
    if (!res.ok) throw new PayPalError(res.status, data, res.headers.get("paypal-debug-id") ?? undefined);
    return data as T;
  }
  createOrder(amount: number, currency: string, description: string,
    intent: "AUTHORIZE" | "CAPTURE" = "AUTHORIZE", requestId: string = randomUUID(), urls?: CheckoutUrls) {
    return this.call<PayPalOrder>("POST", "/v2/checkout/orders", {
      intent,
      purchase_units: [{ description: description.slice(0, 127), amount: {
        currency_code: currency, value: usdValue(amount, currency),
      } }],
      ...(urls ? { payment_source: { paypal: { experience_context: {
        return_url: urls.returnUrl, cancel_url: urls.cancelUrl,
        brand_name: "Mandate & Guardian", user_action: "CONTINUE",
      } } } } : {}),
    }, requestId);
  }
  authorizeOrder(id: string, requestId = requestIdFor("authorize", id)) {
    return this.call<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(id)}/authorize`, {}, requestId);
  }
  captureOrder(id: string, requestId = requestIdFor("capture-order", id)) {
    return this.call<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, requestId);
  }
  captureAuthorization(id: string, requestId = requestIdFor("capture-auth", id)) {
    return this.call<Payment>("POST", `/v2/payments/authorizations/${encodeURIComponent(id)}/capture`, { final_capture: true }, requestId);
  }
  voidAuthorization(id: string, requestId = requestIdFor("void", id)) {
    return this.call<Record<string, never>>("POST", `/v2/payments/authorizations/${encodeURIComponent(id)}/void`, undefined, requestId);
  }
  refundCapture(id: string, amount?: { value: number; currency: string }, note?: string,
    requestId = requestIdFor(amount ? `refund-${amount.currency}-${amount.value.toFixed(2)}` : "refund-full", id)) {
    return this.call<Payment>("POST", `/v2/payments/captures/${encodeURIComponent(id)}/refund`, {
      ...(amount ? { amount: { value: usdValue(amount.value, amount.currency), currency_code: amount.currency } } : {}),
      ...(note ? { note_to_payer: note.slice(0, 255) } : {}),
    }, requestId);
  }
  getOrder(id: string) { return this.call<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`); }
  getAuthorization(id: string) { return this.call<Payment>("GET", `/v2/payments/authorizations/${encodeURIComponent(id)}`); }
  getCapture(id: string) { return this.call<Payment>("GET", `/v2/payments/captures/${encodeURIComponent(id)}`); }
  getRefund(id: string) { return this.call<Payment>("GET", `/v2/payments/refunds/${encodeURIComponent(id)}`); }
  searchTransactions(start: string, end: string, transactionId?: string, page = 1) {
    const a = Date.parse(start), b = Date.parse(end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 31 * 86_400_000 ||
        !Number.isInteger(page) || page < 1) throw new Error("Use a valid search range of at most 31 days and page >= 1.");
    const q = new URLSearchParams({ start_date: new Date(a).toISOString(), end_date: new Date(b).toISOString(),
      fields: "transaction_info", page_size: "100", page: String(page),
      ...(transactionId ? { transaction_id: transactionId } : {}),
    });
    return this.call<TransactionPage>("GET", `/v1/reporting/transactions?${q}`);
  }
  listDisputes() { return this.call<{ items?: { dispute_id?: string; status?: string }[] }>("GET", "/v1/customer/disputes?page_size=20"); }
  getDispute(id: string) {
    return this.call<{ dispute_id?: string; status?: string; disputed_transactions?: { seller_transaction_id?: string }[] }>(
      "GET", `/v1/customer/disputes/${encodeURIComponent(id)}`);
  }
}
export function paypalFromEnv(env = process.env): PayPalClient {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env (Sandbox).");
  return new PayPalClient({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
    baseUrl: env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com" });
}
