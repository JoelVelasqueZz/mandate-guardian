import type { AuditEvent, ChainCheck } from "./audit/chain.js";
import type { ReceiptSigner } from "./guardian/receipt.js";
import type { Store } from "./store.js";
import type { AuditRecord, Receipt } from "./types.js";

export interface Evidence {
  generatedAt: string;
  proposal: AuditRecord["proposal"];
  mandate?: { goal: string; maxPerPurchase: number; maxMonthly: number; currency: string };
  status: AuditRecord["status"];
  decision?: AuditRecord["decision"];
  receipt?: { receipt: Receipt; signatureValid: boolean };
  paypal?: {
    orderId?: string;
    intent?: string;
    authorizationId?: string;
    captureId?: string;
    captureStatus?: string;
    refundId?: string;
    refundStatus?: string;
    charged?: number;
    chargedCurrency?: string;
    capturedAt?: string;
  };
  reconciliation?: AuditRecord["reconciliation"];
  simulated: boolean;
  timeline: AuditEvent[];
  chain: ChainCheck;
}

/** The facts a person needs to explain a decision or file a dispute. No checkout URLs or return tokens. */
export function buildEvidence(record: AuditRecord, store: Store, signer: ReceiptSigner, now = new Date()): Evidence {
  const mandate = store.mandates.get(record.proposal.mandateId);
  const p = record.paypal;
  return {
    generatedAt: now.toISOString(),
    proposal: record.proposal,
    mandate: mandate && {
      goal: mandate.goal,
      maxPerPurchase: mandate.maxPerPurchase,
      maxMonthly: mandate.maxMonthly,
      currency: mandate.currency,
    },
    status: record.status,
    decision: record.decision,
    receipt: record.receipt && { receipt: record.receipt, signatureValid: signer.verifySignature(record.receipt) },
    paypal: p && {
      orderId: p.orderId,
      intent: p.intent,
      authorizationId: p.authorizationId,
      captureId: p.captureId,
      captureStatus: p.captureStatus,
      refundId: p.refundId,
      refundStatus: p.refundStatus,
      charged: p.charged,
      chargedCurrency: p.chargedCurrency,
      capturedAt: p.capturedAt,
    },
    reconciliation: record.reconciliation,
    simulated: Boolean(record.demo?.simulated),
    timeline: store.audit.forProposal(record.proposal.id),
    chain: store.audit.verify(),
  };
}

export function evidenceMarkdown(e: Evidence): string {
  const money = (n?: number, c?: string) => (n === undefined ? "n/a" : `${n.toFixed(2)} ${c ?? ""}`.trim());
  const lines: string[] = [
    `# Evidence: ${e.proposal.title}`,
    "",
    `Generated ${e.generatedAt}. Proposal \`${e.proposal.id}\`. Status: **${e.status}**.`,
    "",
    "## Purchase",
    `- Approved price: ${money(e.proposal.price, e.proposal.currency)}`,
    `- Merchant: ${e.proposal.seller ?? "unknown"}${e.proposal.productId ? ` (product ${e.proposal.productId})` : ""}`,
    e.mandate ? `- Mandate: "${e.mandate.goal}", cap ${e.mandate.maxPerPurchase} per purchase, ${e.mandate.maxMonthly} per month` : "- Mandate: not found",
    "",
    "## Guardian decision",
    e.decision ? `Verdict: **${e.decision.verdict}**. ${e.decision.explanation}` : "No decision recorded.",
    "",
    ...(e.decision?.findings ?? []).map((f) => `- ${f.ok ? "PASS" : "FAIL"} \`${f.rule}\`: ${f.detail}${f.hint ? ` Fix: ${f.hint}` : ""}`),
    "",
    "## Guardian receipt",
    e.receipt
      ? `Signed with Ed25519 key \`${e.receipt.receipt.keyId}\` at ${e.receipt.receipt.payload.issuedAt} (${e.receipt.receipt.payload.verdict}). Signature valid under this server's key: **${e.receipt.signatureValid}**.`
      : "No receipt: the proposal was never approved.",
    "",
    "## PayPal Sandbox",
    `- Order: ${e.paypal?.orderId ?? "none"} (${e.paypal?.intent ?? "n/a"})`,
    `- Authorization: ${e.paypal?.authorizationId ?? "none"}`,
    `- Capture: ${e.paypal?.captureId ?? "none"} (${e.paypal?.captureStatus ?? "n/a"}), charged ${money(e.paypal?.charged, e.paypal?.chargedCurrency)}`,
    `- Refund: ${e.paypal?.refundId ?? "none"} (${e.paypal?.refundStatus ?? "n/a"})`,
    "",
    "## Reconciliation",
    e.reconciliation
      ? `${e.reconciliation.match ? "Match" : "**Mismatch**"}: ${e.reconciliation.detail}${e.simulated ? " This mismatch was **simulated** by the demo scenario; the real PayPal charge was not changed." : ""}`
      : "Not reconciled yet.",
    ...(e.reconciliation?.crossCheck
      ? [`Second reading (PayPal Server SDK): ${e.reconciliation.crossCheck.agrees === null ? "not available" : e.reconciliation.crossCheck.agrees ? "agrees" : "**disagrees**"}. ${e.reconciliation.crossCheck.detail}`]
      : []),
    "",
    "## Timeline (hash-chained)",
    ...e.timeline.map((t) => `- #${t.seq} ${t.at} ${t.type}: ${t.detail} (hash ${t.hash.slice(0, 12)})`),
    "",
    `Audit chain: ${e.chain.ok ? "verified" : `BROKEN at event ${e.chain.brokenAt}`}, ${e.chain.length} events, head ${e.chain.headHash.slice(0, 12)}.`,
    "",
    "This packet is generated from the server's in-memory records. It is meant to support a dispute; it does not file one.",
  ];
  return lines.join("\n");
}
