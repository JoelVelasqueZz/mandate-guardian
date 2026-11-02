import type { AuditRecord } from "../types.js";

/**
 * Post-payment check: compares what the user authorized (approved proposal price)
 * with what PayPal actually charged. A mismatch should trigger a refund proposal.
 */
export function reconcile(record: AuditRecord): { match: boolean; detail: string } {
  const charged = record.paypal?.charged;
  if (charged === undefined) return { match: false, detail: "No charge recorded in PayPal yet." };

  const expected = record.proposal.price;
  const diff = Math.round((charged - expected) * 100) / 100;
  if (diff === 0) return { match: true, detail: `Charged ${charged} matches approved ${expected}.` };
  return {
    match: false,
    detail: `Charged ${charged} but approved ${expected} (difference ${diff > 0 ? "+" : ""}${diff}). Refund recommended.`,
  };
}
