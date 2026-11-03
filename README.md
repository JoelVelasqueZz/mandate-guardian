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
  human. It is unit-tested with a fake model; **it has not been verified against the live Gemini API
  yet**. Without those variables, explanations are deterministic text.
- **Reconciliation:** compares the approved price with an amount charged and flags a mismatch with a
  refund recommendation (`src/guardian/reconcile.ts`). The charged amount is currently sent by the
  caller; it is not yet read from PayPal.
- **PayPal Sandbox client** (`src/paypal/client.ts`, plain `fetch`, no SDK): create order,
  authorize, capture, void, refund and get order are implemented. **Only "create order" is wired into
  the API** (`POST /api/proposals/:id/pay`, intent `AUTHORIZE`, returns the buyer approval link).
  Buyer approval, authorize, capture, void and refund are not wired into the API, and none of this has
  been verified end to end against the Sandbox yet.
- **REST API** (Express, in-memory store, data is lost on restart) and **11 unit tests** for the
  Guardian rules and reconciliation.

## Not built yet

Buyer agent (Mandate) and product search with [Channel3](https://trychannel3.com), AI reviewer model,
natural-language mandates, web UI and AG Grid dashboard, PayPal transaction lookup and dispute
handling, deployment on Render. The dashboard feed (`GET /api/records`) exists; the dashboard does not.

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

Only the payment step and the smoke script need PayPal Sandbox credentials:

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
| POST | `/api/proposals/:id/reconcile` | Compare the approved price with a charged amount |
| GET | `/api/records` | Audit records |

## Security notes

- PayPal **Sandbox** only. Never commit `.env`; it is git-ignored.
- Spending caps live in deterministic code and are not delegated to a model.

## License

MIT
