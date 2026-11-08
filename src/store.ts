import { AuditChain } from "./audit/chain.js";
import type { AuditRecord, Mandate, PaymentStatus } from "./types.js";

/** In-memory store for the MVP. Swap for SQLite/Postgres if time allows. */
export class Store {
  mandates = new Map<string, Mandate>();
  records = new Map<string, AuditRecord>();
  /** Tamper-evident log of every decision and every payment step. */
  audit = new AuditChain();
  private lastStatus = new Map<string, PaymentStatus>();

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
    this.logChange(record);
  }

  /** Appends one audit event when a proposal first appears and each time its status changes. */
  private logChange(record: AuditRecord) {
    const id = record.proposal.id;
    const from = this.lastStatus.get(id);
    if (from === record.status) return;
    this.lastStatus.set(id, record.status);
    const p = record.paypal;
    const data = {
      price: record.proposal.price,
      currency: record.proposal.currency,
      verdict: record.decision?.verdict,
      from,
      to: record.status,
      orderId: p?.orderId,
      authorizationId: p?.authorizationId,
      captureId: p?.captureId,
      refundId: p?.refundId,
      charged: p?.charged,
      simulated: record.demo?.simulated,
    };
    const detail = from
      ? `Status ${from} -> ${record.status}.`
      : `Guardian reviewed "${record.proposal.title}" for ${record.proposal.price} ${record.proposal.currency}: ${record.decision?.verdict ?? "no decision"}.`;
    this.audit.append(id, from ? `status.${record.status}` : "proposal.reviewed", detail, data);
  }
}
