import type { Catalog, ProductHit } from "../channel3/client.js";
import { queryFromGoal } from "../mandate/agent.js";
import type { Mandate, Proposal } from "../types.js";

export interface Alternative {
  productId: string;
  title: string;
  price: number;
  currency: string;
  merchant?: string;
  url?: string;
  imageUrl?: string;
}

export interface AlternativesResult {
  alternatives: Alternative[];
  /** The ceiling the search used: the lower of the per-purchase cap and what is left of the month. */
  maxPrice: number;
}

/**
 * When the Guardian blocks a purchase, searches the same catalog for products that DO fit the mandate:
 * in stock, in the mandate currency, under the per-purchase cap and under what is left of the month.
 * The results are web data and only suggestions; choosing one sends it back through the Guardian.
 */
export async function findAlternatives(
  catalog: Catalog,
  mandate: Mandate,
  blocked: Proposal,
  spentThisMonth: number,
  limit = 3,
): Promise<AlternativesResult> {
  const monthlyLeft = Math.max(0, mandate.maxMonthly - spentThisMonth);
  const maxPrice = Math.min(mandate.maxPerPurchase, monthlyLeft);
  if (maxPrice <= 0) return { alternatives: [], maxPrice: 0 };

  const hits = await catalog.search(queryFromGoal(mandate.goal) || mandate.goal, { maxPrice, limit: 15 });
  const allowed = mandate.allowedCategories.map((c) => c.toLowerCase());
  const fits = (h: ProductHit) =>
    h.inStock &&
    h.currency === mandate.currency &&
    h.price <= maxPrice &&
    h.productId !== blocked.productId &&
    // A category the catalog does not report cannot be checked here, so only a known mismatch is dropped.
    (allowed.length === 0 || !h.category || allowed.includes(h.category.toLowerCase()));

  const alternatives = hits.filter(fits).slice(0, limit).map((h) => ({
    productId: h.productId,
    title: h.title,
    price: h.price,
    currency: h.currency,
    merchant: h.merchant,
    url: h.url,
    imageUrl: h.imageUrl,
  }));
  return { alternatives, maxPrice };
}

/** Builds a proposal from catalog data only, so nothing in it comes from the client. */
export function proposalFromHit(mandate: Mandate, hit: ProductHit, replacing: Proposal): Omit<Proposal, "id"> {
  return {
    mandateId: mandate.id,
    productId: hit.productId,
    title: hit.title,
    seller: hit.merchant,
    category: hit.category,
    price: hit.price,
    currency: hit.currency,
    url: hit.url,
    reasoning: `Suggested by the Guardian as an alternative to "${replacing.title}", which it blocked.`,
  };
}
