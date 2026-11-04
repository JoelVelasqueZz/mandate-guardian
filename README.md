# Mandate & Guardian: Trust Layer for AI Shopping Agents

> The agent that spends is not the one that watches.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). **Sandbox prototype.**

The idea: a buyer agent (**Mandate**) can only *propose* purchases inside the rules a user sets.
An independent auditor (**Guardian**) approves, blocks or asks a human *before* any PayPal payment,
then reconciles what was charged and recommends a refund when something doesn't match.

## What works today

- **Guardian rules (deterministic code, no AI):** currency, per-purchase cap, monthly cap, allowed
  categories, delivery deadline and "price matches the live listing". Any failed rule blocks the
  proposal; a passing proposal above the mandate's human-confirmation threshold asks a person.
  See `src/guardian/rules.ts`.
- **AI reviewer:** `src/guardian/guardian.ts` accepts an optional reviewer that can only make a
  verdict stricter (approve -> ask_human), never override a block. `src/guardian/ai-reviewer.ts`
  implements it on top of a Gemini REST client (`src/guardian/llm.ts`); it is enabled only when
  `AI_API_KEY` and `AI_MODEL` are set. If the model fails or answers badly, the purchase goes to a
  human. The prompt includes the current date (America/Guayaquil). It is unit-tested with a fake
  model, and `npm run smoke:ai` runs four cases against the real model in `.env` (checked by the
  author on Nov 3 with `gemini-3.1-flash-lite`, three runs with the same results; model answers can vary). Without those variables,
  explanations are deterministic text.
- **Reconciliation:** after a capture, `POST /api/proposals/:id/reconcile` reads the capture from PayPal
  (amount and currency) and compares it with the approved price. An optional demo overcharge
  (`ENABLE_DEMO_SCENARIO=true`) is labeled as simulated and never changes the real captured amount.
- **PayPal Sandbox payments** (`src/paypal/`, plain `fetch`, sandbox host only): create order with
  buyer approval link and return/cancel pages, authorize, capture, void, full refund, order and
  capture lookup, Transaction Search and disputes read methods. Payment routes check the proposal
  status, re-run the Guardian rules before authorizing or capturing, use deterministic idempotency
  keys and lock each proposal while an operation runs. **Plan A is the main flow.** Authorize
  the buyer-approved order, then capture or void it. Plan B remains the tested direct-capture
  fallback. Human confirmation and payment routes require `DEMO_API_KEY`.
- **Buyer agent, Mandate** (`src/mandate/agent.ts`): turns the mandate goal into a search query,
  searches the catalog under the per-purchase cap, keeps in-stock items in the mandate currency and
  proposes one. With `AI_API_KEY`/`AI_MODEL` set, the same Gemini model writes the query and picks
  the best fit with a short reason; otherwise it takes the most relevant result. Listings are passed
  to the model as untrusted data. **Mandate cannot pay:** it never imports the PayPal client (a unit
  test enforces this) and never fills `listedPrice`.
- **Product search with [Channel3](https://trychannel3.com)** (`src/channel3/client.ts`, plain
  `fetch`): `POST /v1/search` with a price filter and `GET /v1/products/{id}`. Used when
  `CHANNEL3_API_KEY` is set. Without a key the app uses a small offline catalog and reports
  `"source": "demo"` everywhere, so demo data is never shown as live. The client is unit-tested with a
  mocked HTTP layer; `npm run smoke:channel3` calls the live API. Checked by the author on Nov 3
  against the live API: search and product re-read return title, offers with `price.price`,
  `availability` and the merchant `domain` (no separate seller name), and a full `/shop` run proposed
  a real product that the Guardian approved.
- **Server-side price verification** (`src/guardian/listing.ts`): the server reads the product from
  the catalog by `productId` and sets `listedPrice` itself; a `listedPrice` sent by the client is always
  discarded. The `price_verified` and `price_matches_listing` rules then compare the proposed price with
  the catalog. A proposal with no `productId`, an unknown product, a currency mismatch or a catalog
  that cannot be reached is **blocked** (it fails closed). Unit and endpoint tests cover each case;
  against the demo catalog only, not repeated against live Channel3 after this change.
- **Natural-language mandates** (`src/mandate/parse-mandate.ts`, needs the AI model): turns a request
  such as "a gift for my mom, max $40, by Friday" into a mandate draft for the user to review. The
  model never invents a spending cap; missing caps come back as questions.
- **Dashboard and REST API:** the AG Grid dashboard shows Guardian decisions, PayPal Sandbox
  states and reconciliation. Mock mode uses browser-only sample rows. API Backend mode loads
  audit records from the Express server and supports the full Plan A checkout sequence.
  Data is held in memory and cleared on restart.

See the [PayPal Sandbox setup, demo run and Render instructions](docs/PAYPAL-TESTING.md).

## Verification status

| Scope | Evidence |
|---|---|
| Combined app | Automated tests exercise two complete Plan A rounds using mocked PayPal HTTP and the demo catalog. They verify approval, duplicate-order prevention, rejection of a blocked payment, capture, reconciliation, human-confirmed refund and separate void. |
| PayPal Sandbox | Edison verified the direct CLI Plan A and B flows and a separate buyer dispute. Transaction Search returned HTTP 403. The app uses the capture lookup for reconciliation. See [Sandbox results](docs/SANDBOX-RESULTS.md). |
| Channel3 and Gemini | The team verified each provider separately before integration. The combined flow with the real Sandbox buyer and live providers still needs a new run. |
| Render | The Blueprint, compiled app and checkout origin logic are ready. Deployment and a checkout against the published URL need to be verified on the team's service. |

The demo is single-user. Durable storage, individual authentication, webhooks and
automatic dispute submission are outside its current scope.

## Quick start

Requires Node.js 22.

```bash
git clone https://github.com/JoelVelasqueZz/mandate-guardian.git
cd mandate-guardian
npm ci
npm test
npm run typecheck
npm run build
npm start
```

Open [localhost:3000](http://localhost:3000). The dashboard opens in Mock mode for a
credential-free walkthrough. Switch to **API Backend** to use the integrated server.
For PayPal checkout, configure the seller and separate Personal Sandbox buyer
using the [testing guide](docs/PAYPAL-TESTING.md). Run `npm run verify:plan-a`
in a second terminal to produce two audit files.

## Configuration

Copy `.env.example` to `.env` and fill only what you need. Never commit `.env`.

| Variable | Needed for |
|---|---|
| `AI_API_KEY`, `AI_MODEL` | AI reviewer, buyer agent and natural-language mandates (Google AI Studio key). Empty: rules only. |
| `CHANNEL3_API_KEY` | Live product search. Empty: labeled offline demo catalog. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal **Sandbox** app credentials. |
| `PAYPAL_PLAN`, `APP_BASE_URL` | Set Plan A. For local runs, set the app origin. Render provides the HTTPS origin when `APP_BASE_URL` is unset. |
| `DEMO_API_KEY` | **Required for human confirmation and payment routes.** Set it to a random string of your own; it is a shared demo access key, not a PayPal credential. Without it the payment routes answer 503. Clients send `Authorization: Bearer <DEMO_API_KEY>`. |
| `ENABLE_DEMO_SCENARIO` | Optional: `true` enables the labeled simulated overcharge. |

Use `npm run smoke:paypal` for a direct Sandbox order or
`npm run verify:plan-a` for the integrated demo with its buyer approval and refund prompts.

To try the AI reviewer, set `AI_API_KEY` (Google AI Studio) and `AI_MODEL` in `.env` and run
`npm run smoke:ai`.

To search live products, set `CHANNEL3_API_KEY` and run
`npm run smoke:channel3 -- "birthday gift for mom" 40`.

Try the buyer agent without any keys (demo catalog):

```bash
curl -s -X POST localhost:3000/api/mandates -H "Content-Type: application/json" \
  -d '{"goal":"a birthday gift for my mom","maxPerPurchase":40,"maxMonthly":100}'
# then, with the returned id:
curl -s -X POST localhost:3000/api/mandates/<id>/shop -H "Content-Type: application/json" -d '{}'
```

## API

"Demo key" means the route requires `Authorization: Bearer <DEMO_API_KEY>`. The other routes have no
authentication; this is a single-user demo API.

| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/api/health` | none | Health, catalog source, AI status, selected PayPal plan and demo overcharge flag |
| GET | `/api/mandates` | none | List mandates for the dashboard |
| POST | `/api/mandates/parse` | none | Natural language to a mandate draft (needs the AI model) |
| POST | `/api/mandates` | none | Create the user's spending rules |
| POST | `/api/mandates/:id/shop` | none | Mandate searches the catalog and proposes; the Guardian reviews the proposal |
| POST | `/api/proposals` | none | Submit a purchase proposal; the Guardian reviews it |
| POST | `/api/proposals/:id/confirm` | demo key | A human confirms a proposal the Guardian flagged |
| GET | `/api/records` | none | Audit records with checkout URLs and return tokens omitted |
| POST | `/api/proposals/:id/pay` | demo key | Create the PayPal Sandbox order for an approved proposal; returns the buyer approval link |
| GET | `/api/proposals/:id/paypal` | demo key | Read the PayPal order, to check buyer approval |
| POST | `/api/proposals/:id/authorize` | demo key | Plan A: authorize the buyer-approved order |
| POST | `/api/proposals/:id/capture` | demo key | Capture the authorization (Plan A) or the approved order (Plan B) |
| POST | `/api/proposals/:id/void` | demo key | Cancel an uncaptured authorization |
| POST | `/api/proposals/:id/reconcile` | demo key | Read the PayPal capture and compare amount and currency |
| POST | `/api/proposals/:id/demo-overcharge` | demo key | Labeled simulated overcharge (only if `ENABLE_DEMO_SCENARIO=true`) |
| POST | `/api/proposals/:id/refund` | demo key | Full refund; the body must be `{"confirm": true}` |
| GET | `/api/paypal/transactions` | demo key | Transaction Search (returned 403 in the team's sandbox) |
| GET | `/paypal/return`, `/paypal/cancel` | none | Pages PayPal redirects the buyer to; they never capture a payment |

Payment details and the request contract are in [docs/PAYPAL-TESTING.md](docs/PAYPAL-TESTING.md).

## Security notes

- PayPal **Sandbox** only. Never commit `.env`; it is git-ignored.
- Spending caps live in deterministic code and are not delegated to a model.
- Use only synthetic mandates and Sandbox data in the shared demo. The demo key gates
  confirmation and payment. Public audit rows omit checkout links and return tokens.

## License

MIT
