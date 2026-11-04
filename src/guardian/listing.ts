import type { Catalog } from "../channel3/client.js";
import type { Proposal } from "../types.js";

export interface ListingCheck {
  ok: boolean;
  detail: string;
  /** The price read from the catalog. Only set when ok is true. */
  listedPrice?: number;
}

/**
 * Reads the proposed product from the catalog by its product id. The Guardian trusts this price
 * and never a price sent by the buyer. Anything that cannot be verified fails (the proposal is blocked).
 */
export async function verifyListing(catalog: Catalog, proposal: Proposal): Promise<ListingCheck> {
  if (!proposal.productId) {
    return { ok: false, detail: "The proposal has no productId, so its price cannot be verified against the catalog." };
  }
  let live;
  try {
    live = await catalog.getProduct(proposal.productId);
  } catch {
    return { ok: false, detail: "The catalog could not be reached, so the price could not be verified." };
  }
  if (!live) return { ok: false, detail: `Product ${proposal.productId} was not found in the catalog.` };
  if (live.currency !== proposal.currency) {
    return { ok: false, detail: `The listing is in ${live.currency} but the proposal is in ${proposal.currency}.` };
  }
  return { ok: true, listedPrice: live.price, detail: `Price read from the ${catalog.source} catalog.` };
}
