# CaféBot behavior audit

Date: 2026-10-09. Reference: `prompts/system-prompt.md`, with the user's subsequent implementation requests taking precedence over its outdated descriptions.

## Confirmed findings before fixes

1. **Address approval could precede readback.** A delivery draft containing an address and unit but missing a phone asked only for the phone. A later request could add the phone and set `addressConfirmed: true` without the server ever having repeated the address. The new regression test failed before the fix. Address approval now requires a server-recorded review of that exact address/unit, recorded when the address question or complete review is returned. Corrections invalidate it.
2. **Incomplete item additions cleared valid confirmation.** An attempted addition lacking quantity returned a question, added no line, but changed the previously confirmed order to an unconfirmed draft. The new regression test failed before the fix. The clarification path now preserves the existing review metadata while revalidating menu prices and discounts; unchanged orders retain confirmation, while actual changes still invalidate it.
3. **The system prompt described obsolete capabilities and arithmetic.** It said the project had only a static page, prohibited collection of fulfillment details, treated all customizations as unverified, and instructed the model to calculate totals. These statements conflicted with the implemented, user-authorized local backend. The prompt now describes the actual development capabilities, menu-backed options, backend-only arithmetic, required delivery readback, review tokens, and local confirmed-order saving. It continues to prohibit claims of payment, live inventory, or external cafe acceptance.

## Verification after fixes

**61 backend tests passed, zero failed**, including the two previously failing audit regressions. Tests use temporary order files; the real `data/orders.json` was not populated with audit orders.

| Requested area | Evidence and result |
| --- | --- |
| Menu accuracy | Server context includes the exact menu file; request-supplied prices cannot override it. Unknown/unavailable products, unlisted sizes/options, malformed menu data, invalid prices, and duplicate IDs are rejected. Menu updates are reloaded. Passed. |
| Missing information | Missing quantity, size without a default, and required options return questions without adding partial items. Pickup reuses a supplied name and accepts no pickup-time preference. Delivery questions include only unanswered fields and distinguish explicit none from silence. Passed. |
| Item modifications | Quantity, size, and option edits use current menu choices and recalculated prices, target the selected line even with duplicate products, and reset review when changed. Invalid edits leave the order intact. Removal and quantity reduction retain unrelated details. Passed. |
| Delivery details | Name, formatted phone, supplied full-address text, unit, and instructions are stored across partial updates. No location is inferred from a phone. Invalid field types/lengths and invalid phone formats are rejected. Passed. |
| Address confirmation | Full address and unit are repeated. Approval requires prior readback, corrections require fresh approval, and ordinary draft confirmation cannot bypass it. Passed, including the new premature-approval regression. |
| Totals and promotions | Menu sizes/options and quantities determine prices in integer cents. Active promotions require every eligibility condition, exclude add-ons from discounts, honor caps, and use the best single discount. Tax and delivery fee come from explicit configuration; rounding, invalid configuration, refresh, and model-supplied numeric overrides are tested. Passed. |
| Explicit checkout confirmation | Complete final review supplies a token bound to session and summary. Missing/wrong/stale tokens, incomplete drafts, and conversation replies such as “maybe,” “looks okay,” or “yes” cannot confirm. Only explicit structured confirmation saves a record. Retry deduplication, failed-save recovery, and immutable saved snapshots after draft edits are tested. Passed. |

Command:

```text
node --test backend/audit.test.js backend/server.test.js backend/order-state.test.js backend/order-summary.test.js backend/recommendations.test.js backend/promotions.test.js backend/pricing.test.js backend/order-store.test.js
```

## Scope and limits

This verifies deterministic backend behavior through structured actions, HTTP tests, and temporary JSON persistence. The customer chat in `frontend/chat.js` remains an explicitly labeled local mock: it neither invokes `/api/chat` nor performs the backend order flow. The backend's general reply generator is also mocked; no live language model consumes the prompt. Natural-language intent extraction, multilingual replies, complaint handling, allergy conversations, and conversational prompt-injection resistance cannot be verified as model behavior yet. No AI connection or frontend wiring was added during this audit.

Address collection verifies supplied fields and explicit review, not postal deliverability. Pricing and promotions remain sample configuration; saving is local, not payment or external cafe submission. The staff dashboard remains a loopback development workspace without staff authentication. These are existing limitations, not changes introduced to resolve the audit findings.

Changed only the two failing backend paths, their regression coverage, the obsolete prompt passages, and this report. No UI redesign, new order feature, database, or provider integration was added.
