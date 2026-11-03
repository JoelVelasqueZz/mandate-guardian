import type { Decision, Mandate, Proposal } from "../types.js";
import { runRules, verdictFromFindings, type RuleContext } from "./rules.js";

/**
 * Optional AI layer. Plug a model in here: it judges what code cannot
 * (does the product match the intent? does the seller or price look off?)
 * and writes the plain-language explanation. It may only make a verdict STRICTER,
 * never override a failed hard rule.
 */
export type AiReviewer = (input: {
  mandate: Mandate;
  proposal: Proposal;
  ruleFindings: Decision["findings"];
}) => Promise<{ suspicious: boolean; explanation: string }>;

export async function review(
  mandate: Mandate,
  proposal: Proposal,
  ctx: RuleContext,
  ai?: AiReviewer,
): Promise<Decision> {
  const findings = runRules(mandate, proposal, ctx);
  let verdict = verdictFromFindings(mandate, proposal, findings);
  let explanation = fallbackExplanation(verdict, findings);

  if (ai) {
    const review = await ai({ mandate, proposal, ruleFindings: findings });
    // Keep the rule-based reason on a block; the AI text only adds to it.
    explanation = verdict === "block" ? `${explanation} ${review.explanation}`.trim() : review.explanation || explanation;
    // The AI can only escalate: approve -> ask_human.
    if (review.suspicious && verdict === "approve") verdict = "ask_human";
  }

  return { proposalId: proposal.id, verdict, findings, explanation };
}

function fallbackExplanation(verdict: Decision["verdict"], findings: Decision["findings"]): string {
  const failed = findings.filter((f) => !f.ok);
  if (verdict === "block") return `Blocked: ${failed.map((f) => f.rule).join(", ")}. ${failed.map((f) => f.detail).join(" ")}`;
  if (verdict === "ask_human") return "All rules pass, but this purchase needs your confirmation.";
  return "All rules pass. Approved.";
}
