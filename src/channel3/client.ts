/**
 * Channel3 product search, plain fetch like the PayPal client (no SDK).
 * Docs: https://docs.trychannel3.com (POST /v1/search, GET /v1/products/{id}, header x-api-key).
 *
 * Checked against the live API on Nov 3: offers carry `price.price`, `currency`, `availability`
 * ("InStock") and the merchant `domain`; there is no separate seller name. Parsing stays defensive.
 */

/** One product as the rest of the app sees it. Everything here is untrusted web data. */
export interface ProductHit {
  productId: string;
  title: string;
  price: number;
  currency: string;
  inStock: boolean;
  /** Merchant domain from the offer (Channel3 gives a domain, not a seller name). */
  merchant?: string;
  brand?: string;
  category?: string;
  url?: string;
  imageUrl?: string;
}

export interface SearchOptions {
  maxPrice?: number;
  limit?: number;
}

/** What the buyer agent and the Guardian need from a catalog. Lets tests and the demo swap Channel3 out. */
export interface Catalog {
  readonly source: "channel3" | "demo";
  search(query: string, opts?: SearchOptions): Promise<ProductHit[]>;
  /** Re-reads one product's live listing. Used by the Guardian, never trusted from the buyer. */
  getProduct(productId: string): Promise<ProductHit | undefined>;
}

export interface Channel3Config {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined);

/** Reads a price that may be a number, or an object with price/amount/current. */
function readPrice(v: unknown): { price?: number; currency?: string } {
  const direct = num(v);
  if (direct !== undefined) return { price: direct };
  const o = obj(v);
  if (!o) return {};
  return { price: num(o.price) ?? num(o.amount) ?? num(o.current), currency: str(o.currency) };
}

function isInStock(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return s === "instock" || s === "limitedavailability" || s === "available";
}

/** Turns one raw product into a hit, using its first in-stock offer (or the first offer). */
export function normalizeProduct(raw: unknown): ProductHit | undefined {
  const p = obj(raw);
  if (!p) return undefined;
  const id = str(p.id) ?? str(p.product_id);
  const title = str(p.title) ?? str(p.name);
  if (!id || !title) return undefined;

  const offers = Array.isArray(p.offers) ? p.offers.map(obj).filter((o): o is Json => !!o) : [];
  const offer = offers.find((o) => isInStock(o.availability)) ?? offers[0];
  const fromOffer = offer ? readPrice(offer.price) : {};
  const fromProduct = readPrice(p.price);
  const price = fromOffer.price ?? fromProduct.price;
  if (price === undefined || price <= 0) return undefined;

  const brand = str(p.brand_name) ?? str(obj(p.brand)?.name) ?? str(p.brand);
  const image = str(p.image_url) ?? str(obj(Array.isArray(p.images) ? p.images[0] : undefined)?.url);
  const category = Array.isArray(p.categories) ? str(p.categories[0]) : str(p.category);

  return {
    productId: id,
    title,
    price,
    currency: (fromOffer.currency ?? fromProduct.currency ?? "USD").toUpperCase(),
    inStock: offer ? isInStock(offer.availability) : isInStock(p.availability),
    merchant: offer ? str(offer.domain) ?? str(offer.merchant) : undefined,
    brand,
    category,
    url: (offer && str(offer.url)) ?? str(p.url),
    imageUrl: image,
  };
}

export class Channel3Client implements Catalog {
  readonly source = "channel3" as const;
  constructor(private cfg: Channel3Config) {}

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const base = this.cfg.baseUrl ?? "https://api.trychannel3.com";
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { "x-api-key": this.cfg.apiKey, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
    });
    const text = await res.text();
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Channel3 ${res.status} ${path}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : undefined;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<ProductHit[]> {
    const body: Json = { query, limit: Math.min(Math.max(opts.limit ?? 10, 1), 30) };
    if (opts.maxPrice !== undefined) body.filters = { price: { max_price: opts.maxPrice } };
    const data = obj(await this.call("/v1/search", { method: "POST", body: JSON.stringify(body) }));
    const products = Array.isArray(data?.products) ? data.products : [];
    return products.map(normalizeProduct).filter((h): h is ProductHit => !!h);
  }

  async getProduct(productId: string): Promise<ProductHit | undefined> {
    return normalizeProduct(await this.call(`/v1/products/${encodeURIComponent(productId)}`));
  }
}

/**
 * Offline catalog so the UI and the demo run without a Channel3 key.
 * Every response carries source "demo" so nobody mistakes it for live data.
 */
export class DemoCatalog implements Catalog {
  readonly source = "demo" as const;
  constructor(private items: ProductHit[] = DEMO_PRODUCTS) {}

  async search(query: string, opts: SearchOptions = {}): Promise<ProductHit[]> {
    const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const score = (h: ProductHit) => words.filter((w) => `${h.title} ${h.category ?? ""}`.toLowerCase().includes(w)).length;
    return this.items
      .filter((h) => opts.maxPrice === undefined || h.price <= opts.maxPrice)
      .map((h) => ({ h, s: score(h) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, opts.limit ?? 10)
      .map(({ h }) => h);
  }

  async getProduct(productId: string): Promise<ProductHit | undefined> {
    return this.items.find((h) => h.productId === productId);
  }
}

export const DEMO_PRODUCTS: ProductHit[] = [
  { productId: "demo-mug", title: "Hand-painted ceramic mug with gift box", price: 24, currency: "USD", inStock: true, merchant: "demo-shop.example", category: "gifts" },
  { productId: "demo-scarf", title: "Soft knit scarf for mom, gift wrapped", price: 35, currency: "USD", inStock: true, merchant: "demo-shop.example", category: "gifts" },
  { productId: "demo-candle", title: "Lavender scented candle gift set", price: 18, currency: "USD", inStock: false, merchant: "demo-shop.example", category: "gifts" },
  { productId: "demo-watch", title: "Classic leather watch gift for mom", price: 129, currency: "USD", inStock: true, merchant: "demo-shop.example", category: "gifts" },
];

/** Live Channel3 when CHANNEL3_API_KEY is set, otherwise the labeled demo catalog. */
export function catalogFromEnv(env = process.env): Catalog {
  return env.CHANNEL3_API_KEY ? new Channel3Client({ apiKey: env.CHANNEL3_API_KEY }) : new DemoCatalog();
}
