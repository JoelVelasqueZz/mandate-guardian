# PayPal Sandbox testing

The team chose **Plan A**. Guardian reviews the proposal before the backend opens checkout.
The Personal Sandbox buyer approves the PayPal order, then the app authorizes it and
either captures or voids the authorization. The demo uses USD, one purchase unit, one
final capture and one full refund. A Channel3 listing is used for product validation.

## Configure and run locally

Use Node.js 22. In PowerShell, run these commands from the repository root.

```powershell
npm.cmd ci
if (-not (Test-Path .\.env)) { Copy-Item .\.env.example .\.env }
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

In [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/), select
**Sandbox**, open **Apps & Credentials**, and create or open a Merchant app linked to a
Business Sandbox seller. Add its Client ID and Secret to `.env`. Under **Testing Tools →
Sandbox Accounts**, get the login for a separate Personal Sandbox buyer. Use that account
in the PayPal checkout window.

Paste the generated value into `DEMO_API_KEY`. Set `PAYPAL_PLAN=A`,
`APP_BASE_URL=http://localhost:3000` and `ENABLE_DEMO_SCENARIO=true`. Keep
`PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`. For a deterministic first run, leave
`CHANNEL3_API_KEY`, `AI_API_KEY` and `AI_MODEL` empty. The app reports that catalog as
`demo`. Configure the team-owned provider keys and model when verifying the live catalog
and reviewer.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```

The built app serves the dashboard and API from one origin at
[localhost:3000](http://localhost:3000). Select **API Backend** in the dashboard to see
server records. Enter the same `DEMO_API_KEY` in its settings for payment actions. The
browser retains it for the current tab through checkout. The **Mock** mode has separate
sample data and simulates checkout entirely in the browser.

## Run two integrated Sandbox rounds

Keep the server open. In a second PowerShell terminal, run:

```powershell
npm.cmd run verify:plan-a
```

The script runs the buyer agent and Guardian with a USD 40 cap per purchase. It uses
the resulting catalog item for the approved, blocked and void cases. To specify a
search phrase, pass the app URL and query, for example:

```powershell
npm.cmd run verify:plan-a -- http://localhost:3000 "ceramic mug gift"
```

For each round:

1. If Guardian requests human confirmation, read the explanation and type `CONFIRM`
   to approve it. A blocked proposal must return HTTP 409 when payment is attempted.
2. Open the printed PayPal Sandbox link and approve as the Personal buyer. Confirm
   that the return page loads, then type `APPROVED` in the terminal. The script checks
   the remote order and verifies that retrying checkout reused the same order ID.
3. The script authorizes, captures and reconciles using the capture lookup. It then
   creates a clearly labeled overcharge simulation. Type `REFUND` after reviewing the
   original amount to issue the full Sandbox refund.
4. Approve the separate checkout printed for the void case. It is authorized and
   voided before capture. Verify the resulting row in the dashboard.
5. Save the two completed JSON files from `.local/edison-paypal/api/`. They include
   each mandate, decision, payment IDs, actual amount, separate simulation, and final
   audit rows. A partial run retains its last saved checkpoint. If a capture or refund
   is pending, check the same proposal in the app and consult its PayPal status before
   starting another run.

To rehearse in the dashboard, create a mandate without a delivery date, use the
shopping agent to find a mug, and pay an approved proposal in API Backend mode. After
PayPal returns, click **Return to the dashboard**, **Verify & authorize**, then capture.
From the capture, reconcile or simulate an overcharge. Review the refund prompt before
sending the refund. On a separate order, select **Void** while the authorization is
still uncaptured.

## API contract

`Authorization: Bearer <DEMO_API_KEY>` is required for human confirmation and payment
API routes. Enter this key in the demo tab only. PayPal credentials stay on the server.

| Method | Route | Request or result |
|---|---|---|
| GET | `/api/mandates` | Restores mandates in the dashboard after checkout |
| GET | `/api/records` | Audit rows without checkout URLs or return state |
| POST | `/api/proposals/:id/confirm` | Confirms an `awaiting_human` proposal |
| POST | `/api/proposals/:id/pay` | Creates or reuses an approved checkout; returns `{record, approveUrl}` |
| GET | `/api/proposals/:id/paypal` | Returns the record and order ID, intent and status |
| POST | `/api/proposals/:id/authorize` | Authorizes a buyer-approved Plan A order |
| POST | `/api/proposals/:id/capture` | Captures the authorization; HTTP 202 means pending |
| POST | `/api/proposals/:id/void` | Cancels and verifies a separate uncaptured authorization |
| POST | `/api/proposals/:id/reconcile` | Reads the amount and currency from the PayPal capture; HTTP 202 means pending |
| POST | `/api/proposals/:id/demo-overcharge` | Body `{"charged":32.5}` for a USD 24 capture; requires the demo flag |
| POST | `/api/proposals/:id/refund` | Body `{"confirm":true}`; polls the existing refund if pending |
| GET | `/api/paypal/transactions` | Optional `start`, `end`, `transactionId`, `page`; date range up to 31 days |
| GET | `/paypal/return`, `/paypal/cancel` | Checkout landing pages with a dashboard link; payment operations are explicit |

The rows for Joel and Jhon contain `paypal.orderId`, `authorizationId`, `captureId`,
`refundId`, status fields, the gross captured `charged` and `chargedCurrency`.
`reconciliation.source` distinguishes `paypal_capture` and `simulated`.
`demo.charged` holds the simulated amount. A full refund uses the actual capture.
Keep `refunded` as the final status while preserving the simulation as audit history.
The MVP verifies amount and currency. A Sandbox payment has no retail fulfilment.

## What has been verified

- [Sandbox results](SANDBOX-RESULTS.md) records the original direct CLI tests, including
  buyer approval, void, refund, the manual dispute and the team's choice of Plan A.
- `npm test` runs the app through two complete Plan A rounds with PayPal HTTP mocked.
  Only runs with the real Sandbox buyer provide new Sandbox payment evidence.
- Transaction Search returned HTTP 403 with the team's Sandbox credentials. The
  dashboard reconciles through the capture lookup. Buyer hold release remains a
  separate manual observation from the API's `VOIDED` status.

The `edison:paypal` CLI is available for isolated Sandbox operations. Its `report`
command regenerates the results file from local state, so preserve the team decision
and manual notes if you regenerate it.

## Official PayPal references

- [Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts)
- [Orders API](https://developer.paypal.com/api/orders/v2/)
- [Payments API](https://developer.paypal.com/api/payments/v2/)
- [Transaction Search](https://developer.paypal.com/api/transaction-search/v1/)
