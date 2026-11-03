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
- **Reconciliation:** the payment API reads the PayPal capture amount and currency. An optional
  demo overcharge scenario is labeled as simulated and keeps the real captured amount unchanged.
- **PayPal Sandbox integration:** server-side create, buyer approval link/return, authorize,
  capture, void, full refund, capture lookup, Transaction Search and disputes read methods.
  The payment routes use a private demo access key, deterministic idempotency keys,
  state checks and per-proposal locks. **Real sandbox execution is still pending.**
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

## Not built yet

Web UI and AG Grid dashboard, automatic dispute submission, durable storage, webhook handling, user authentication, deployment on Render.

## Quick start

Requires Node.js 22.

```bash
git clone https://github.com/JoelVelasqueZz/mandate-guardian.git
cd mandate-guardian
npm install
npm test                 # Guardian rules and reconciliation
npm run typecheck
npm run dev              # API on http://localhost:3000
```

Payment routes and the smoke script need server-side PayPal Sandbox credentials.
The routes also require a random DEMO_API_KEY and APP_BASE_URL in .env:

```bash
cp .env.example .env     # then fill PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (Sandbox)
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

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Health check; also reports the catalog source and whether AI is on |
| POST | `/api/mandates/parse` | Natural language to a mandate draft (needs the AI model) |
| POST | `/api/mandates` | Create the user's spending rules |
| POST | `/api/mandates/:id/shop` | Mandate searches and proposes; the Guardian reviews the proposal |
| POST | `/api/proposals` | Submit a purchase proposal; Guardian reviews it |
| POST | `/api/proposals/:id/confirm` | Human confirms a flagged proposal |
| POST | `/api/proposals/:id/pay` | Create a PayPal Sandbox order for an approved proposal |
| POST | `/api/proposals/:id/reconcile` | Read the PayPal capture and compare amount/currency |
| GET | `/api/records` | Audit records |

## Security notes

- PayPal **Sandbox** only. Never commit `.env`; it is git-ignored.
- Spending caps live in deterministic code and are not delegated to a model.

## License

MIT

The table above shows the original core API. For authorize/capture/void/refund, callbacks,
new pending states and the required demo header, use [PAYPAL-TESTING.md](docs/PAYPAL-TESTING.md).
