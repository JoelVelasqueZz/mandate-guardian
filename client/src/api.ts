import { AuditRecord, Mandate, SystemHealth } from "./types";

const authHeaders = (demoKey?: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (demoKey) headers["Authorization"] = `Bearer ${demoKey}`;
  return headers;
};

/** Calls the backend and turns an error response into an Error with the server's message. */
async function request<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : fallback;
    throw new Error(message);
  }
  return data as T;
}

const post = (body: unknown, demoKey?: string): RequestInit => ({
  method: "POST",
  headers: authHeaders(demoKey),
  body: JSON.stringify(body),
});

export interface MandateDraft extends Partial<Mandate> {}

export const api = {
  getHealth: () => request<SystemHealth>("/api/health", "Could not reach the server."),

  getRecords: () => request<AuditRecord[]>("/api/records", "Could not load the audit records."),

  createMandate: (data: Omit<Mandate, "id">) =>
    request<Mandate>("/api/mandates", "Could not save the mandate.", post(data)),

  parseMandate: (text: string) =>
    request<{ ok: boolean; draft?: MandateDraft; questions?: string[] }>(
      "/api/mandates/parse",
      "Could not read the mandate with the AI model.",
      post({ text }),
    ),

  runShop: (mandateId: string, query?: string) =>
    request<{ run: unknown; record?: AuditRecord }>(
      `/api/mandates/${mandateId}/shop`,
      "The shopping agent failed.",
      post({ query }),
    ),

  confirmHuman: (id: string) =>
    request<AuditRecord>(`/api/proposals/${id}/confirm`, "Could not confirm the proposal.", post({})),

  payWithPayPal: (id: string, demoKey: string) =>
    request<{ record: AuditRecord; approveUrl: string }>(
      `/api/proposals/${id}/pay`,
      "Could not create the PayPal Sandbox order.",
      post({}, demoKey),
    ),

  authorize: (id: string, demoKey: string) =>
    request<AuditRecord>(`/api/proposals/${id}/authorize`, "Could not authorize the payment.", post({}, demoKey)),

  capture: (id: string, demoKey: string) =>
    request<AuditRecord>(`/api/proposals/${id}/capture`, "Could not capture the payment.", post({}, demoKey)),

  voidAuth: (id: string, demoKey: string) =>
    request<AuditRecord>(`/api/proposals/${id}/void`, "Could not void the authorization.", post({}, demoKey)),

  reconcile: (id: string, demoKey: string) =>
    request<AuditRecord>(`/api/proposals/${id}/reconcile`, "Could not reconcile with PayPal.", post({}, demoKey)),

  demoOvercharge: (id: string, charged: number, demoKey: string) =>
    request<AuditRecord>(
      `/api/proposals/${id}/demo-overcharge`,
      "Could not record the simulated overcharge.",
      post({ charged }, demoKey),
    ),

  refund: (id: string, demoKey: string) =>
    request<AuditRecord>(
      `/api/proposals/${id}/refund`,
      "Could not issue the refund.",
      post({ confirm: true }, demoKey),
    ),
};
