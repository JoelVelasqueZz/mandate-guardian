import "dotenv/config";
import { Channel3Client } from "../src/channel3/client.js";

/**
 * Live Channel3 check. Prints the raw first product (to confirm field names, e.g. whether a
 * seller name comes back) and what the app normalizes it to.
 * Usage: npm run smoke:channel3 -- "gift for mom" 40
 */
const apiKey = process.env.CHANNEL3_API_KEY;
if (!apiKey) {
  console.error("Set CHANNEL3_API_KEY in .env first (promo code PAYPAL-HACKATHON-2026).");
  process.exit(1);
}
const query = process.argv[2] ?? "birthday gift for mom";
const maxPrice = process.argv[3] ? Number(process.argv[3]) : 40;

const base = process.env.CHANNEL3_BASE_URL ?? "https://api.trychannel3.com";
const res = await fetch(`${base}/v1/search`, {
  method: "POST",
  headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({ query, limit: 3, filters: { price: { max_price: maxPrice } } }),
});
const raw = await res.json();
console.log(`HTTP ${res.status}`);
console.log("Raw first product:\n", JSON.stringify(raw?.products?.[0] ?? raw, null, 2));

const hits = await new Channel3Client({ apiKey, baseUrl: base }).search(query, { maxPrice, limit: 3 });
console.log("\nNormalized:");
console.table(hits.map(({ productId, title, price, currency, inStock, merchant }) => ({ productId, title: title.slice(0, 50), price, currency, inStock, merchant })));
if (hits[0]) {
  const again = await new Channel3Client({ apiKey, baseUrl: base }).getProduct(hits[0].productId);
  console.log(`\nRe-read ${hits[0].productId}: price ${again?.price ?? "not found"} (Guardian uses this as listedPrice)`);
}
