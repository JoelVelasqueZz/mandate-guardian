import type { AgDataSourcesDefinition } from "ag-studio";
import type { AuditEvent, AuditRecord } from "../types";

/** One plain sentence per status, so a chart of "outcome" reads like a story and not like a state machine. */
export function outcomeOf(r: AuditRecord): string {
  switch (r.status) {
    case "blocked": return "Stopped before payment";
    case "awaiting_human": return "Waiting for a human";
    case "approved":
    case "awaiting_paypal":
    case "capture_pending": return "Approved, not paid yet";
    case "authorized": return "Funds on hold";
    case "voided": return "Hold released";
    case "captured":
    case "reconciled": return "Paid";
    case "alert": return "Overcharge caught";
    case "refunded": return "Refunded";
    default: return "Under review";
  }
}

const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);

export interface StudioRows {
  proposals: Record<string, string | number | null>[];
  findings: Record<string, string | number | null>[];
  events: Record<string, string | number | null>[];
}

/** Flattens the live dashboard data into the tables AG Studio queries. No PayPal ids or receipts go in. */
export function buildRows(records: AuditRecord[], events: AuditEvent[]): StudioRows {
  const proposals = records.map((r) => {
    const charged = r.paypal?.charged ?? r.demo?.charged ?? null;
    return {
      id: r.proposal.id,
      title: r.proposal.title,
      seller: r.proposal.seller ?? "Unknown seller",
      category: r.proposal.category ?? "uncategorized",
      price: r.proposal.price,
      currency: r.proposal.currency,
      verdict: r.decision?.verdict ?? "unreviewed",
      status: r.status,
      outcome: outcomeOf(r),
      stopped_value: r.status === "blocked" ? r.proposal.price : 0,
      charged,
      overcharge: charged !== null && charged > r.proposal.price ? Math.round((charged - r.proposal.price) * 100) / 100 : 0,
      day: day(r.createdAt ?? r.updatedAt) ?? null,
    };
  });
  const findings = records.flatMap((r) =>
    (r.decision?.findings ?? []).map((f) => ({
      id: `${r.proposal.id}:${f.rule}`,
      proposal_id: r.proposal.id,
      rule: f.rule,
      result: f.ok ? "Passed" : "Failed",
      detail: f.detail,
    })),
  );
  const rows = events.map((e) => ({
    id: `evt-${e.seq}`,
    seq: e.seq,
    proposal_id: e.proposalId,
    type: e.type,
    day: day(e.at) ?? null,
    detail: e.detail,
  }));
  return { proposals, findings, events: rows };
}

/** The table definitions the Guardian Analyst reads. Descriptions are what the AI sees, so they say what each is for. */
export function buildStudioData(rows: StudioRows): AgDataSourcesDefinition {
  return {
    description:
      "Mandate & Guardian audit data. A buyer agent proposes purchases; an independent Guardian approves, blocks or asks a human before any PayPal payment, then reconciles what was charged. Money is in the mandate currency. `stopped_value` is the price of purchases the Guardian blocked before any money moved.",
    sources: [
      {
        id: "proposals",
        name: "Purchase proposals",
        description: "One row per purchase the buyer agent proposed, with the Guardian's verdict and where the payment ended up.",
        primaryKeyField: "id",
        data: rows.proposals,
        fields: [
          { id: "id", name: "Proposal", format: "textFormat", hide: true },
          { id: "title", name: "Product", format: "textFormat" },
          { id: "seller", name: "Seller", format: "textFormat" },
          { id: "category", name: "Category", format: "textFormat" },
          { id: "price", name: "Price", format: "currencyFormat", formatOptions: { format: "$#,##0.00" }, description: "The price the Guardian approved or blocked." },
          { id: "currency", name: "Currency", format: "textFormat" },
          { id: "verdict", name: "Guardian verdict", format: "textFormat", description: "approve, block, ask_human or unreviewed." },
          { id: "status", name: "Payment status", format: "textFormat" },
          { id: "outcome", name: "Outcome", format: "textFormat", description: "Plain-language result: stopped before payment, paid, refunded and so on." },
          { id: "stopped_value", name: "Stopped before payment", format: "currencyFormat", formatOptions: { format: "$#,##0.00" }, description: "Price of purchases the Guardian blocked before any money moved." },
          { id: "charged", name: "Charged by PayPal", format: "currencyFormat", formatOptions: { format: "$#,##0.00" }, description: "What PayPal actually charged, when a payment was captured." },
          { id: "overcharge", name: "Overcharge", format: "currencyFormat", formatOptions: { format: "$#,##0.00" }, description: "Charged minus approved price, when the charge was higher." },
          { id: "day", name: "Day", format: "textFormat" },
        ],
      },
      {
        id: "findings",
        name: "Rule findings",
        description: "One row per rule the Guardian checked on a proposal, and whether it passed.",
        primaryKeyField: "id",
        data: rows.findings,
        fields: [
          { id: "id", name: "Finding", format: "textFormat", hide: true },
          { id: "proposal_id", name: "Proposal", format: "textFormat", hide: true },
          { id: "rule", name: "Rule", format: "textFormat", description: "For example per_purchase_cap, monthly_cap, category_allowed, price_verified, seller_trust." },
          { id: "result", name: "Result", format: "textFormat", description: "Passed or Failed." },
          { id: "detail", name: "Detail", format: "textFormat" },
        ],
      },
      {
        id: "events",
        name: "Audit events",
        description: "The hash-chained audit log: every Guardian decision and payment step.",
        primaryKeyField: "id",
        data: rows.events,
        fields: [
          { id: "id", name: "Event", format: "textFormat", hide: true },
          { id: "seq", name: "Sequence", format: "integerFormat" },
          { id: "proposal_id", name: "Proposal", format: "textFormat", hide: true },
          { id: "type", name: "Event type", format: "textFormat" },
          { id: "day", name: "Day", format: "textFormat" },
          { id: "detail", name: "What happened", format: "textFormat" },
        ],
      },
    ],
    relationships: [
      { id: "findings_to_proposals", type: "many-to-one", source: { tableId: "findings", fieldId: "proposal_id" }, target: { tableId: "proposals", fieldId: "id" } },
      { id: "events_to_proposals", type: "many-to-one", source: { tableId: "events", fieldId: "proposal_id" }, target: { tableId: "proposals", fieldId: "id" } },
    ],
  };
}
