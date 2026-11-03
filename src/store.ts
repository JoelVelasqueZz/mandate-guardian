import type { AuditRecord, Mandate } from "./types.js";

/** In-memory store for the MVP. Swap for SQLite/Postgres if time allows. */
export class Store {
  mandates = new Map<string, Mandate>();
  records = new Map<string, AuditRecord>();

  spentThisMonth(mandateId: string, now = new Date(), excludeProposalId?: string): number {
    let total = 0;
    for (const r of this.records.values()) {
      if (r.proposal.id === excludeProposalId || r.proposal.mandateId !== mandateId) continue;
      if (!["approved", "awaiting_paypal", "authorized", "capture_pending", "captured", "reconciled", "alert", "refund_pending"].includes(r.status)) continue;
      const d = new Date(r.paypal?.capturedAt ?? r.createdAt ?? r.updatedAt);
      if (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()) {
        total += r.paypal?.charged ?? r.proposal.price;
      }
    }
    return total;
  }

  upsert(record: AuditRecord) {
    record.updatedAt = new Date().toISOString();
    record.createdAt ??= record.updatedAt;
    this.records.set(record.proposal.id, record);
  }
}
