import type { Catalog } from "../channel3/client.js";
import type { Store } from "../store.js";
import type { AuditRecord, Mandate, Proposal } from "../types.js";
import { review, type AiReviewer } from "./guardian.js";
import { verifyListing } from "./listing.js";
import type { ReceiptSigner } from "./receipt.js";

/**
 * Guardian side of a proposal. The price is read from the catalog by productId; a listedPrice sent
 * by the client is always discarded. If the price cannot be verified, the rules block the proposal.
 * Shared by the real API and by the red-team runner, so both exercise exactly the same code.
 */
export async function reviewAndStore(
  deps: { catalog: Catalog; store: Store; ai?: AiReviewer; signer?: ReceiptSigner },
  mandate: Mandate,
  proposal: Proposal,
): Promise<AuditRecord> {
  delete proposal.listedPrice;
  const listing = await verifyListing(deps.catalog, proposal);
  if (listing.ok) proposal.listedPrice = listing.listedPrice;

  const decision = await review(
    mandate,
    proposal,
    { spentThisMonth: deps.store.spentThisMonth(mandate.id), priceVerification: listing },
    deps.ai,
  );
  const status = decision.verdict === "approve" ? "approved" : decision.verdict === "block" ? "blocked" : "awaiting_human";
  const record: AuditRecord = { proposal, decision, status, updatedAt: "" };
  // Only an approval gets a receipt. A blocked or human-pending proposal has nothing to sign yet.
  if (status === "approved" && deps.signer) record.receipt = deps.signer.issue(mandate, record, false);
  deps.store.upsert(record);
  return record;
}
