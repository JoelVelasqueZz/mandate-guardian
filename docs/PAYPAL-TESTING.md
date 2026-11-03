# PayPal Sandbox testing and frontend handoff

This integration is a sandbox-only hackathon prototype. It uses USD, one purchase unit,
one final capture and one full refund. No real-money or live PayPal endpoint is enabled.
It does not place an order with a Channel3 retailer or implement shipping/fulfilment.

## Run locally

Use Node.js 22 or newer. Run `npm ci`, copy `.env.example` to `.env` and set the
PayPal sandbox app credentials, `APP_BASE_URL`, `PAYPAL_PLAN` and a random `DEMO_API_KEY`.
Then run `npm test`, `npm run typecheck`, `npm run build` and `npm run dev`.
This build uses `npm start` -> `node dist/src/server.js`.

PayPal setup:

1. Sign into https://developer.paypal.com/dashboard/ with your own developer account.
2. Choose Sandbox and open Apps & Credentials. Create a Merchant app associated with
   your Business sandbox seller. Copy the Client ID and Secret into the server `.env`.
3. Open Testing Tools > Sandbox Accounts. Retrieve a separate Personal sandbox buyer's
   login under View/Edit account. Its email/password are checkout credentials, not API keys.
4. Start the local server. Run `npm run smoke:paypal`, open its approval URL and use the
   Personal sandbox buyer. Never approve with the seller account or a live PayPal account.
5. Follow the Spanish internal guide for the complete CLI test matrix. The CLI calls
   PayPal directly; its orders do not create application audit records.

## API contract for Jhon

Payment API requests use `Authorization: Bearer <DEMO_API_KEY>`.
This is a shared demo access key, not PayPal's OAuth token. Do not embed PayPal secrets
or a permanent demo key in committed frontend files. The shared demo gate does not
implement individual user authentication, permissions or production account isolation.
The current mandates/records API remains the original in-memory demo API.

| Method | Route | Request / result |
|---|---|---|
| POST | `/api/proposals/:id/pay` | Only approved proposals; returns `{record, approveUrl}` |
| GET | `/api/proposals/:id/paypal` | Returns `{record, order}`; read `order.status` to verify buyer approval |
| POST | `/api/proposals/:id/authorize` | Plan A, after buyer approval; returns the updated record |
| POST | `/api/proposals/:id/capture` | Plan A captures authorization; Plan B captures the approved order |
| POST | `/api/proposals/:id/void` | Cancels an uncaptured authorization; returns `voided` only after verification |
| POST | `/api/proposals/:id/reconcile` | Empty body; reads PayPal capture, never trusts a caller-supplied charge |
| POST | `/api/proposals/:id/refund` | Body `{"confirm":true}`; one full refund; poll the same route if pending |
| POST | `/api/proposals/:id/demo-overcharge` | Body `{"charged":27.5}`; requires `ENABLE_DEMO_SCENARIO=true` |
| GET | `/api/paypal/transactions` | Optional `start`, `end`, `transactionId`, `page`; date range <=31 days |
| GET | `/paypal/return` | Return landing page; never captures automatically |
| GET | `/paypal/cancel` | Cancel landing page; an existing authorization still needs an explicit void |

Use existing `POST /api/proposals/:id/confirm` for Guardian human confirmation.
That confirmation and PayPal buyer approval are two separate steps.
New status values for AG Grid: `awaiting_paypal`, `capture_pending`, `refund_pending`.
Keep all original status values, including `refunded` as the final refund state.
Do not automatically display a refunded purchase as reconciled or successfully paid.

Example frontend call (obtain the private demo key from a manual demo session):

```ts
const response = await fetch(`/api/proposals/${proposalId}/pay`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${demoKey}` },
  body: "{}",
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
window.location.assign(result.approveUrl);
```

Serve frontend and API from the same origin for this MVP. The kit does not add a separate
frontend server, a CORS policy, or frontend screens.

## Data contract for Joel

Each audit row keeps `paypal.orderId`, `authorizationId`, `captureId`, `refundId`,
`intent`, `captureStatus`, `refundStatus`, `charged`, `chargedCurrency`, `capturedAt`.
`charged` is the gross captured amount, not the seller's net proceeds after fees.
`reconciliation.source` distinguishes `paypal_capture` and `simulated`.
Demo data lives in `demo: {simulated:true, charged:...}` and never replaces the real
`paypal.charged`. A full refund returns only the actual captured amount.

The existing AiReviewer hook is unchanged. Joel connects the team's chosen model.
Hard spending rules stay deterministic, and the reviewer must never relax `block`.
The kit rechecks those rules before payment and before an uncaptured charge is made.
Approval reservations now count towards the monthly cap. Completed full refunds and
voids release those reservations. Budget dates use capture/creation dates, not later
reconciliation timestamps. Validate that budget policy with the team.

This MVP compares amount and currency. Product identity and true duplicate-charge
detection still require Joel/Cristopher's Channel3 and reconciliation work.

## Evidence and plan selection

`npm run edison:paypal -- report` creates `docs/SANDBOX-RESULTS.md`.
Responses and stable test identifiers stay in `.local/edison-paypal/`, ignored by git.
Do not publish raw payer, address, credentials or OAuth data.

Choose Plan A only after create, buyer approval, authorize, capture, separate void and
refund succeed, and the buyer interaction fits the demo. Verify hold release separately.
Test Plan B's independent CAPTURE and refund cycle if authorization-specific operations
fail. Wrong credentials or missing buyer approval are not solved by switching plans.
`PAYPAL_PLAN=A` in the example is a development setting, not evidence that A has passed.

Transaction Search can lag by up to three hours. A missing row immediately after capture
does not mean the capture failed. Capture data powers immediate reconciliation.
An empty disputes list or a successful GET does not prove buyer dispute creation works.
Use a separate, unrefunded transaction and the Personal sandbox Resolution Center.
The sandbox dispute-create API requires buyer-side setup; the merchant's key alone is
not a general buyer dispute-create capability.

## Render

Create/update the team's Node Web Service. Use build command
`npm ci --include=dev && npm run build` and start command `npm start`.
Set `NODE_VERSION=22`, the sandbox app credentials, `PAYPAL_PLAN`, `DEMO_API_KEY`,
`APP_BASE_URL=https://YOUR-SERVICE.onrender.com` and the demo scenario flag.
Let Render provide `PORT`. Never set APP_BASE_URL to the PayPal API host.
After changing the base URL, create new orders so their return URLs use the new origin.

All application audit data, locks and tokens are held in one process. Keep the demo on
one instance and do not restart between approval and capture/refund. Durable operation,
multi-instance locks and webhook verification are outside this kit. Do not retry an old
payment after losing its record; inspect its PayPal state first. Public demo deployments
also need team decisions on user authentication, storage and dependencies before broader use.

## Official references

- https://developer.paypal.com/api/get-started/
- https://developer.paypal.com/sandbox-testing/accounts
- https://developer.paypal.com/api/orders/v2/orders-create
- https://developer.paypal.com/api/payments/v2/
- https://developer.paypal.com/api/transaction-search/v1/search-get
- https://developer.paypal.com/disputes/set-up/
- https://developer.paypal.com/disputes/test-go-live
- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/configure-environment-variables
