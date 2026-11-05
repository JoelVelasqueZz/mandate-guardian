# Edison: PayPal Sandbox Results

Generated: 2026-11-03T21:21:27.366Z

| #   | Test                                | Result | Observation                                                                         | Private raw evidence                                             |
| --- | ----------------------------------- | ------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Create AUTHORIZE order              | OK     | AUTHORIZE order 5MF2785674664283U; status PAYER_ACTION_REQUIRED.                    | .local/edison-paypal/1793737216403-create-A-7e89e5.json          |
| 2   | Buyer approval verified             | OK     | Buyer check: order 5MF2785674664283U is APPROVED.                                   | .local/edison-paypal/1793737608847-check-A-81215d.json           |
| 3   | Authorize order                     | OK     | Authorization 8F508325TN575002J, status CREATED.                                    | .local/edison-paypal/1793737708619-authorize-A-bd3f1a.json       |
| 4   | Capture authorization               | OK     | Capture 27M81611E30548422, status COMPLETED, amount 10.00 USD.                      | .local/edison-paypal/1793737829861-capture-A-042fb9.json         |
| 5   | Void a second authorization         | OK     | Authorization 4JL62153AA234521A is VOIDED. Check buyer hold release separately.     | .local/edison-paypal/1793738035530-void-VOID-1489f9.json         |
| 6   | Full refund                         | OK     | Refund 6K9399774K6642244, status COMPLETED.                                         | .local/edison-paypal/1793738172848-refund-A-afd460.json          |
| 7   | Transaction Search finds capture    | FAIL   | PayPal 403: NOT_AUTHORIZED Authorization failed due to insufficient permissions.    | .local/edison-paypal/1793738563752-search-A-54ad95.json          |
| 8   | Create a sandbox dispute (optional) | OK     | Sandbox buyer dispute PP-R-CKH-10196222 verified against capture 2C557457F9904191U. | .local/edison-paypal/1793739519862-dispute-confirm-A-022c43.json |

Plan A technical cycle: PASSED.

Plan B independent capture/refund cycle: PASSED.

## Team decision and observations

- **Plan A approved by the team on November 4, 2026.** The main flow authorizes the buyer-approved order before capture and can void a separate uncaptured authorization. Plan B remains the tested direct-capture fallback.
- Buyer approval was first verified through the direct CLI. The integrated dashboard checkout was run on November 4 (see "Integrated dashboard run" below): the buyer signs in and approves in PayPal, then PayPal redirects back to `/paypal/return`.
- The separate authorization returned `VOIDED` from PayPal. In the November 4 dashboard run the buyer's available Sandbox balance rose by the voided amount (see below). The release time was not measured.
- The buyer's Sandbox activity showed the USD 10.00 Plan A refund credited back to the PayPal balance.
- Transaction Search returned 403 and the OAuth token lacked the required permission. Indexing delay could not be measured. The app reconciles through the capture lookup.
- The buyer created a Sandbox dispute on a separate capture, and the seller API verified the relationship. This was a manual buyer action.

These results were collected using the CLI against PayPal Sandbox. Integrated runs use new orders and are recorded separately.

Raw resource responses are stored locally and ignored by git. Never publish credentials, OAuth tokens or buyer information.

## Plan B evidence

| Test                             | Result    | PayPal Sandbox ID |
| -------------------------------- | --------- | ----------------- |
| Create and approve CAPTURE order | APPROVED  | 9XA32704J1984382L |
| Direct capture of USD 10.00      | COMPLETED | 7CS6236864427384V |
| Full refund of USD 10.00         | COMPLETED | 9KV20932YR276124U |

## Integrated dashboard run (November 4, 2026, local)

Run by Joel on one machine with the integrated code (`integration/final`): live Channel3 search and
price re-read, the Gemini model for the buyer agent and the Guardian reviewer, PayPal Sandbox with a
separate Personal buyer account, Plan A, driven from the dashboard. The records live in the server's
memory only; no raw evidence files were saved to git.

| # | Flow | Result |
|---|---|---|
| 1 | Mandate searches Channel3 (USD 17.99 item), Guardian approves with `price_verified` and `price_matches_listing`, checkout in the same tab, buyer approves, return to the dashboard, verify and authorize, capture, reconcile | Captured USD 17.99 (`COMPLETED`), reconciliation matched the approved amount using the PayPal capture lookup |
| 2 | Same product, human confirmation with the demo key, pay, authorize, capture, labeled simulated overcharge (USD 26.49), full refund | Status `alert` with `source: simulated`, then refund `COMPLETED`. The buyer's activity showed the USD 17.99 refund credited back |
| 3 | Same product, pay, authorize, then void (no capture) | Status `voided`. Buyer's available balance went from USD 4,964.02 to USD 4,982.01 (+17.99) and the pending authorization entry disappeared |

Observations
- The buyer signed in, chose the payment method ("Continue and review order") and approved. The exact number of PayPal screens was not recorded. PayPal then redirected to `/paypal/return` with the order token, `PayerID` and the app's `state`, and the app validated them.
- The demo key survived the same-tab redirect (session storage).
- In run 2 the Gemini reviewer escalated an otherwise valid proposal to a human because the Channel3 buy link goes through `buy.trychannel3.com`. It is a false positive, kept as a known issue (see the README). A human confirmation with the demo key moved the proposal on.
- Real Transaction Search is still unavailable (HTTP 403), so reconciliation uses the capture lookup.
- Only the Sandbox was used. The Render deployment was not part of this run.
