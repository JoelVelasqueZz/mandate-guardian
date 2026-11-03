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

## Human observations (fill after generating this report)

- Buyer approval clicks / seconds: TODO
- Return to app worked: TODO
- VOIDED verified in API: TODO
- Buyer hold release observed (time / balance): TODO
- Search lag: see step 7; pending results are not payment failures.
- Dispute: list permission alone does not prove create permission.
- Chosen plan: Recommend Plan A for team review. Both plans passed in Sandbox. Plan A lets Guardian cancel an authorization before capture, while Plan B is the simpler option for direct capture after buyer approval.

Credential errors, buyer approval failures and refund failures affect both plans. Diagnose them before switching to B.

Raw resource responses are stored locally and ignored by git. Never publish credentials, OAuth tokens or buyer information.

## Plan B evidence

| Test                             | Result    | PayPal Sandbox ID |
| -------------------------------- | --------- | ----------------- |
| Create and approve CAPTURE order | APPROVED  | 9XA32704J1984382L |
| Direct capture of USD 10.00      | COMPLETED | 7CS6236864427384V |
| Full refund of USD 10.00         | COMPLETED | 9KV20932YR276124U |
