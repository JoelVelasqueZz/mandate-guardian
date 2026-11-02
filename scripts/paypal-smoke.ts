import "dotenv/config";
import { paypalFromEnv } from "../src/paypal/client.js";

/**
 * Day-1 task: run `npm run smoke:paypal` once .env has sandbox credentials.
 * Reports what the sandbox actually allows, so the team can pick Plan A or Plan B.
 */
const paypal = paypalFromEnv();

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const out = await fn();
    console.log(`OK    ${name}`, JSON.stringify(out).slice(0, 200));
    return out;
  } catch (e) {
    console.log(`FAIL  ${name}`, String(e).slice(0, 300));
  }
}

const order = (await step("create order (intent AUTHORIZE)", () => paypal.createOrder(10, "USD", "smoke test", "AUTHORIZE"))) as
  | { id: string; links: { rel: string; href: string }[] }
  | undefined;

if (order) {
  const approve = order.links.find((l) => l.rel === "approve")?.href;
  console.log("\nOpen this link, log in with a SANDBOX buyer and approve:\n" + approve);
  console.log("\nThen run the authorize / capture / void / refund steps against order", order.id);
  console.log("Question to answer: can an agent flow work with buyer approval, or do we need Plan B?");
}
