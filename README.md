# Mandate & Guardian: Trust Layer for AI Shopping Agents

> The agent that spends is not the one that watches.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). **Work in progress.**

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
  keys and lock each proposal while an operation runs. Set `PAYPAL_PLAN` to `A` (authorize, then
  capture or void) or `B` (capture directly after buyer approval); the team has not made the final
  choice. All payment routes require `DEMO_API_KEY` (see Configuration).
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
- **Listing re-check:** before the Guardian reviews a proposal that has a `productId`, the server
  re-reads the live listing and sets `listedPrice` itself, so the `price_matches_listing` rule
  compares against the catalog, not against what the buyer claimed. If the listing cannot be re-read,
  the proposal goes to a human.
- **Natural-language mandates** (`src/mandate/parse-mandate.ts`, needs the AI model): turns a request
  such as "a gift for my mom, max $40, by Friday" into a mandate draft for the user to review. The
  model never invents a spending cap; missing caps come back as questions.
- **REST API** (Express, in-memory store, data is lost on restart) with unit tests for the Guardian, AI reviewer, buyer agent, Channel3 and PayPal routes.

See [PayPal setup and frontend handoff](docs/PAYPAL-TESTING.md).

## Verification status

- **Unit tests:** the project tests, typecheck and build pass locally with mocked PayPal, Channel3 and
  model calls. They check the logic, not the real services.
- **PayPal Sandbox:** run by Edison on the PayPal branch before integration (details in
  [docs/SANDBOX-RESULTS.md](docs/SANDBOX-RESULTS.md)): order, buyer approval, authorize, capture, void,
  refund, a direct-capture flow and a test dispute worked. **Transaction Search returned 403** (insufficient
  permissions), so reconciliation relies on the capture response. Still to confirm: how many steps the
  buyer approval takes and whether returning to the app works, and whether voiding an authorization
  releases the buyer's hold.
- **Channel3:** checked against the live API by Cristopher on the Mandate branch before integration. It
  returns title, price, availability and the merchant domain, but no seller name and no delivery date.
- **Gemini:** `npm run smoke:ai` was run with `gemini-3.1-flash-lite` on the AI reviewer branch.
- **After integrating these branches, no real PayPal, Channel3 or Gemini call was repeated on the
  combined code.** The combined flow (search, Guardian review, payment, reconciliation, refund) has not
  been tested end to end.

## Not built yet

Web UI and AG Grid dashboard, automatic dispute submission, durable storage, webhook handling, user
authentication and deployment on Render.

## Quick start

Requires Node.js 22.

```bash
git clone https://github.com/JoelVelasqueZz/mandate-guardian.git
cd mandate-guardian
npm install
npm test                 # unit tests (mocked services)
npm run typecheck
npm run dev              # API on http://localhost:3000
```

## Configuration

Copy `.env.example` to `.env` and fill only what you need. Never commit `.env`.

| Variable | Needed for |
|---|---|
| `AI_API_KEY`, `AI_MODEL` | AI reviewer, buyer agent and natural-language mandates (Google AI Studio key). Empty: rules only. |
| `CHANNEL3_API_KEY` | Live product search. Empty: labeled offline demo catalog. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal **Sandbox** app credentials. |
| `PAYPAL_PLAN`, `APP_BASE_URL` | Payment flow (`A` or `B`) and the base URL for PayPal return pages (HTTPS, or HTTP on localhost). |
| `DEMO_API_KEY` | **Required by every payment route.** Set it to a random string of your own; it is a shared demo access key, not a PayPal credential. Without it the payment routes answer 503. Clients send `Authorization: Bearer <DEMO_API_KEY>`. |
| `ENABLE_DEMO_SCENARIO` | Optional: `true` enables the labeled simulated overcharge. |

```bash
cp .env.example .env
npm run smoke:paypal     # creates a Sandbox order and prints the buyer approval link
```

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

`npm run build` followed by `npm start` runs the compiled server.

## API

"Demo key" means the route requires `Authorization: Bearer <DEMO_API_KEY>`. The other routes have no
authentication; this is a single-user demo API.

| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/api/health` | none | Health check; reports the catalog source and whether AI is on |
| POST | `/api/mandates/parse` | none | Natural language to a mandate draft (needs the AI model) |
| POST | `/api/mandates` | none | Create the user's spending rules |
| POST | `/api/mandates/:id/shop` | none | Mandate searches the catalog and proposes; the Guardian reviews the proposal |
| POST | `/api/proposals` | none | Submit a purchase proposal; the Guardian reviews it |
| POST | `/api/proposals/:id/confirm` | none | A human confirms a proposal the Guardian flagged |
| GET | `/api/records` | none | Audit records |
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
- Payment routes need `DEMO_API_KEY`; the rest of the API has no authentication, so do not expose it publicly as is.

## License

MIT
