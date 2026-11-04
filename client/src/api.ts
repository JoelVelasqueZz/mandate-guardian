import { AuditRecord, Mandate, Proposal, SystemHealth } from "./types";

const getHeaders = (demoKey?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (demoKey) {
    headers["Authorization"] = `Bearer ${demoKey}`;
  }
  return headers;
};

export const api = {
  async getHealth(): Promise<SystemHealth> {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error("No se pudo conectar con el servidor.");
    return res.json();
  },

  async getRecords(): Promise<AuditRecord[]> {
    const res = await fetch("/api/records");
    if (!res.ok) throw new Error("Error al obtener registros de auditoría.");
    return res.json();
  },

  async createMandate(data: Omit<Mandate, "id">): Promise<Mandate> {
    const res = await fetch("/api/mandates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Error al crear el mandato.");
    }
    return res.json();
  },

  async parseMandate(text: string): Promise<{ ok: boolean; mandate?: Partial<Mandate>; questions?: string[] }> {
    const res = await fetch("/api/mandates/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Error al interpretar mandato con IA.");
    }
    return data;
  },

  async runShop(mandateId: string, query?: string): Promise<{ run: any; record?: AuditRecord }> {
    const res = await fetch(`/api/mandates/${mandateId}/shop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al ejecutar el agente de compras Mandate.");
    return data;
  },

  async submitProposal(proposal: Omit<Proposal, "id">): Promise<AuditRecord> {
    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proposal),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al registrar propuesta.");
    return data;
  },

  async confirmHuman(id: string): Promise<AuditRecord> {
    const res = await fetch(`/api/proposals/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al confirmar propuesta.");
    return data;
  },

  async payWithPayPal(id: string, demoKey: string): Promise<{ record: AuditRecord; approveUrl: string }> {
    const res = await fetch(`/api/proposals/${id}/pay`, {
      method: "POST",
      headers: getHeaders(demoKey),
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al generar orden de PayPal Sandbox.");
    return data;
  },

  async getPayPalOrder(id: string, demoKey: string): Promise<{ record: AuditRecord; order: any }> {
    const res = await fetch(`/api/proposals/${id}/paypal`, {
      headers: getHeaders(demoKey),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al consultar orden de PayPal.");
    return data;
  },

  async authorize(id: string, demoKey: string): Promise<AuditRecord> {
    const res = await fetch(`/api/proposals/${id}/authorize`, {
      method: "POST",
      headers: getHeaders(demoKey),
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al autorizar pago.");
    return data;
  },

  async capture(id: string, demoKey: string): Promise<AuditRecord> {
    const res = await fetch(`/api/proposals/${id}/capture`, {
      method: "POST",
      headers: getHeaders(demoKey),
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al capturar pago.");
    return data;
  },

  async voidAuth(id: string, demoKey: string): Promise<AuditRecord> {
    const res = await fetch(`/api/proposals/${id}/void`, {
      method: "POST",
      headers: getHeaders(demoKey),
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al anular autorización.");
    return data;
  },

  async reconcile(id: string, demoKey: string): Promise<AuditRecord> {
    const res = await fetch(`/api/proposals/${id}/reconcile`, {
      method: "POST",
      headers: getHeaders(demoKey),
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al conciliar con PayPal.");
    return data;
  },

  async demoOvercharge(id: string, charged: number, demoKey: string): Promise<AuditRecord> {
    const res = await fetch(`/api/proposals/${id}/demo-overcharge`, {
      method: "POST",
      headers: getHeaders(demoKey),
      body: JSON.stringify({ charged }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al simular sobrecargo.");
    return data;
  },

  async refund(id: string, demoKey: string): Promise<AuditRecord> {
    const res = await fetch(`/api/proposals/${id}/refund`, {
      method: "POST",
      headers: getHeaders(demoKey),
      body: JSON.stringify({ confirm: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al emitir reembolso.");
    return data;
  },
};

