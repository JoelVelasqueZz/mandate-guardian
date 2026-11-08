import { AuditChain } from "./audit/chain.js";
import { ReceiptSigner } from "./guardian/receipt.js";
import type { AuditRecord, Mandate } from "./types.js";

export interface IntegrityResult {
  id: string;
  name: string;
  attack: string;
  /** True when the tampering was caught. */
  held: boolean;
  /** What the Guardian reported, in the words the app itself uses. */
  detail: string;
}

const MANDATE: Mandate = {
  id: "redteam-mandate",
  goal: "a birthday gift for my mom",
  currency: "USD",
  maxPerPurchase: 40,
  maxMonthly: 100,
  allowedCategories: ["gifts"],
};

/** A proposal the Guardian approved and signed, built with a throwaway key. */
function approvedRecord(signer: ReceiptSigner): AuditRecord {
  const record: AuditRecord = {
    proposal: {
      id: "redteam-proposal",
      mandateId: MANDATE.id,
      productId: "demo-mug",
      title: "Hand-painted ceramic mug with gift box",
      category: "gifts",
      price: 24,
      listedPrice: 24,
      currency: "USD",
      reasoning: "Fits the goal and the budget.",
    },
    decision: {
      proposalId: "redteam-proposal",
      verdict: "approve",
      findings: [{ rule: "per_purchase_cap", ok: true, detail: "Price 24 vs cap 40." }],
      explanation: "All rules pass. Approved.",
    },
    status: "approved",
    updatedAt: "",
  };
  record.receipt = signer.issue(MANDATE, record, false);
  return record;
}

function sampleChain(): AuditChain {
  const chain = new AuditChain();
  chain.append("redteam-proposal", "proposal.reviewed", "Guardian approved a 24.00 USD mug.", { price: 24 });
  chain.append("redteam-proposal", "status.awaiting_paypal", "Status approved -> awaiting_paypal.", { to: "awaiting_paypal" });
  chain.append("redteam-proposal", "status.authorized", "Status awaiting_paypal -> authorized.", { to: "authorized" });
  chain.append("redteam-proposal", "status.captured", "Status authorized -> captured.", { charged: 24 });
  return chain;
}

/**
 * Attacks on the evidence itself instead of on a purchase: someone edits a signed receipt, changes the
 * price after approval, or rewrites the audit log. Each runs on throwaway data, with a throwaway key,
 * through the same checks the payment route and the log verifier use.
 */
export function runIntegrityChecks(): IntegrityResult[] {
  const results: IntegrityResult[] = [];
  const add = (id: string, name: string, attack: string, held: boolean, detail: string) =>
    results.push({ id, name, attack, held, detail });

  const signer = new ReceiptSigner();

  {
    const record = approvedRecord(signer);
    record.receipt!.payload.price = 1;
    record.proposal.price = 1;
    const problem = signer.checkRecord(record, MANDATE) ?? "Accepted.";
    add("edit-receipt", "Edit a signed receipt", "Change the signed price from 24.00 to 1.00 in the receipt and in the proposal, so they match.",
      /signature is not valid/.test(problem), problem);
  }
  {
    const record = approvedRecord(signer);
    record.proposal.price = 1;
    const problem = signer.checkRecord(record, MANDATE) ?? "Accepted.";
    add("price-after-approval", "Change the price after approval", "Keep the valid receipt but lower the proposal's price afterwards.",
      /changed after the Guardian approved/.test(problem), problem);
  }
  {
    const record = approvedRecord(signer);
    delete record.receipt;
    const problem = signer.checkRecord(record, MANDATE) ?? "Accepted.";
    add("no-receipt", "Pay without a receipt", "Ask the payment route to charge a proposal the Guardian never signed.",
      /never approved/.test(problem), problem);
  }
  {
    const record = approvedRecord(new ReceiptSigner());
    const problem = signer.checkRecord(record, MANDATE) ?? "Accepted.";
    add("foreign-key", "Receipt signed by someone else", "Present a receipt signed with a different key.",
      /signature is not valid/.test(problem), problem);
  }
  {
    const record = approvedRecord(signer);
    const problem = signer.checkRecord(record, { ...MANDATE, maxPerPurchase: 500 }) ?? "Accepted.";
    add("mandate-edit", "Loosen the mandate afterwards", "Raise the per-purchase cap from 40 to 500 after the Guardian approved.",
      /mandate changed/.test(problem), problem);
  }
  {
    const chain = sampleChain();
    chain.events[2].detail = "Status awaiting_paypal -> authorized. (edited)";
    const check = chain.verify();
    add("rewrite-history", "Rewrite history in the audit log", "Edit the text of the third event of a four-event log.",
      !check.ok && check.brokenAt === 2, check.ok ? "Chain accepted the edit." : `Chain broken at event #${check.brokenAt}.`);
  }
  {
    const chain = sampleChain();
    chain.events.splice(1, 1);
    const check = chain.verify();
    add("delete-event", "Delete an event from the audit log", "Remove the second event, as if the order was never created.",
      !check.ok, check.ok ? "Chain accepted the deletion." : `Chain broken at event #${check.brokenAt}.`);
  }
  {
    const chain = sampleChain();
    [chain.events[1], chain.events[2]] = [chain.events[2], chain.events[1]];
    const check = chain.verify();
    add("reorder-events", "Reorder events in the audit log", "Swap two events to change what happened first.",
      !check.ok, check.ok ? "Chain accepted the reorder." : `Chain broken at event #${check.brokenAt}.`);
  }

  return results;
}
