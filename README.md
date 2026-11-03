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
- **AI reviewer hook:** `src/guardian/guardian.ts` accepts an optional reviewer that can only make a
  verdict stricter (approve -> ask_human), never override a block. **No AI model is connected yet**;
  today every explanation is a deterministic text.
- **Reconciliation:** the payment API reads the PayPal capture amount and currency. An optional
  demo overcharge scenario is labeled as simulated and keeps the real captured amount unchanged.
- **PayPal Sandbox integration:** server-side create, buyer approval link/return, authorize,
  capture, void, full refund, capture lookup, Transaction Search and disputes read methods.
  The payment routes use a private demo access key, deterministic idempotency keys,
  state checks and per-proposal locks. **Real sandbox execution is still pending.**
- **REST API** with an in-memory store and 28 local tests (11 original Guardian tests plus
  17 PayPal client/route tests using a mock provider). Data is lost on restart.

See [PayPal setup and frontend handoff](docs/PAYPAL-TESTING.md) for configuration and the
complete API contract. Local tests do not prove a successful PayPal sandbox payment.

## Not built yet

Buyer agent (Mandate) and product search with [Channel3](https://trychannel3.com), AI reviewer model,
natural-language mandates, web UI and AG Grid dashboard, automatic dispute submission,
durable storage, webhook handling, individual user authentication and deployment on Render. The dashboard feed (`GET /api/records`) exists; the dashboard does not.

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

`npm run build` followed by `npm start` runs the compiled server.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/mandates` | Create the user's spending rules |
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
