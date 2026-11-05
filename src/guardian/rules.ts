import type { Finding, Mandate, Proposal, Verdict } from "../types.js";

export interface RuleContext {
  /** Amount already spent this month under this mandate. */
  spentThisMonth: number;
  /** Result of reading the live listing on the server. A failed check blocks the proposal. */
  priceVerification?: { ok: boolean; detail: string };
}

/** Pure, deterministic checks. No AI here on purpose: hard caps must be predictable. */
export function runRules(mandate: Mandate, proposal: Proposal, ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];

  findings.push({
    rule: "currency",
    ok: proposal.currency === mandate.currency,
    detail: `Proposal in ${proposal.currency}, mandate in ${mandate.currency}.`,
  });

  findings.push({
    rule: "per_purchase_cap",
    ok: proposal.price <= mandate.maxPerPurchase,
    detail: `Price ${proposal.price} vs cap ${mandate.maxPerPurchase}.`,
  });

  findings.push({
    rule: "monthly_cap",
    ok: ctx.spentThisMonth + proposal.price <= mandate.maxMonthly,
    detail: `Spent ${ctx.spentThisMonth} + ${proposal.price} vs monthly cap ${mandate.maxMonthly}.`,
  });

  if (mandate.allowedCategories.length > 0) {
    const cat = (proposal.category ?? "").toLowerCase();
    findings.push({
      rule: "category",
      ok: mandate.allowedCategories.map((c) => c.toLowerCase()).includes(cat),
      detail: `Category "${proposal.category ?? "unknown"}" vs allowed [${mandate.allowedCategories.join(", ")}].`,
    });
  }

  if (mandate.deliverBy && proposal.estimatedDelivery) {
    findings.push({
      rule: "delivery_date",
      ok: new Date(proposal.estimatedDelivery) <= new Date(mandate.deliverBy),
      detail: `Delivery ${proposal.estimatedDelivery} vs deadline ${mandate.deliverBy}.`,
    });
  }

  if (ctx.priceVerification) {
    findings.push({ rule: "price_verified", ok: ctx.priceVerification.ok, detail: ctx.priceVerification.detail });
  }

  if (proposal.listedPrice !== undefined) {
    findings.push({
      rule: "price_matches_listing",
      ok: Math.abs(proposal.price - proposal.listedPrice) < 0.005,
      detail: `Proposed ${proposal.price} vs live listing ${proposal.listedPrice}.`,
    });
  }

  return findings;
}

/** Any failed rule blocks. A passing proposal above the human threshold asks a person. */
export function verdictFromFindings(mandate: Mandate, proposal: Proposal, findings: Finding[]): Verdict {
  if (findings.some((f) => !f.ok)) return "block";
  if (mandate.requireHumanAbove !== undefined && proposal.price > mandate.requireHumanAbove) {
    return "ask_human";
  }
  return "approve";
}
