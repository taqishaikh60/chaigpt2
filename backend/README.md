# Development chat endpoint

Requires Node.js 18 or later. No packages need to be installed.

```text
node backend/server.js
```

Listens on `127.0.0.1:3000`; optionally set `PORT` in the environment. Open `http://127.0.0.1:3000/` for the café website and connected Zara chat. This server serves the website, chat endpoint, and staff dashboard on the same origin. A static server on port 5500 cannot serve `/api/chat`.

The default responder is a deterministic menu assistant, with no API key or AI provider required. It uses the current menu for product answers and recommendations. Explicit supported commands such as `add 2 large Americanos`, `change Americano to 1 small`, `remove 1 Americano`, `pickup`, `delivery`, `my order`, and `checkout` are converted to the same validated structured actions documented below. Missing or ambiguous choices do not change the draft. One item/change per message is supported. Chat forms collect missing fulfillment fields; final saving uses the review token through the explicit confirmation button. General yes/okay messages never confirm. Unknown questions explain the supported scope rather than inventing an answer.

The server also keeps bounded per-session conversation context, separately from client history. Pending quantity and product clarifications accept short answers such as `two please` or `vanilla`; product follow-ups and edits accept `it`/`them` when a single item is in focus. A previously asked pickup name or delivery phone/address field can be answered directly when it fits the field. Context never authorizes checkout or assumes missing delivery details. It expires after 30 minutes of inactivity, is isolated between sessions, and is cleared for pending additions when the customer cancels or switches topics. Model/customer history cannot create pending actions. Product comparison, price/size questions, and budget recommendations remain grounded in the current menu; unknown dietary substitutions require staff verification.

Open `http://127.0.0.1:3000/staff` to view saved orders from `data/orders.json`. The dashboard shows order ID, timestamp, items/quantities/customizations, fulfillment type, customer details, total, and status. Use the labeled status selector and Update status button to persist `confirmed`, `preparing`, `ready`, `completed`, or `cancelled`; use Refresh orders to retrieve the latest data. Empty, loading, and error states are shown. The customer-facing landing page is unchanged.

`GET /api/staff/orders` returns saved records without internal confirmation keys. `PATCH /api/staff/orders/:id` accepts only `{ "status": "ready" }` (or another allowed status). It updates the saved record and its order status, adding an `updatedAt` UTC timestamp while retaining the original order ID, confirmation timestamp, items, customer details, and totals. Invalid statuses return 400, unknown IDs 404, cross-origin browser updates 403, and storage errors a generic 500. Reads and updates use the same serialized atomic JSON storage as confirmation saves. Confirmation retries do not reset a staff-updated status.

This staff workspace uses the server's existing loopback binding for local development; staff authentication is not implemented. It serves only the three named dashboard assets, not the data directory. Browser checks: `node scripts/audit-staff.cjs` with Playwright and Edge available. The check uses temporary sample orders and does not modify the real orders file.

Send `POST /api/chat` with `Content-Type: application/json`:

```json
{
  "message": "What is on the menu?",
  "history": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Welcome!" }
  ]
}
```

`history` is optional and defaults to an empty conversation. It contains prior turns, excluding the new `message`. Only `user` and `assistant` roles are accepted. Messages have a 1000-character limit; history has at most 50 entries with up to 4000 characters each. Total request size is limited to 64 KB.

Successful response:

```json
{
  "reply": "These are sample menu prices and availability. …",
  "mode": "menu"
}
```

For each valid request, the endpoint reads `prompts/system-prompt.md` as UTF-8 using a path relative to the backend file, independent of the working directory. When an optional `generateReply` function is injected through `createServer`, it receives the file as the first `system` message, followed by menu/order context, validated history, and the new user message. The default menu assistant uses deterministic server rules and does not call an AI service or interpret the Markdown as executable rules. Missing or empty instructions return a generic 500 error; client-supplied system roles are rejected.

The endpoint also reloads `data/menu.json` for each valid request. A second server-controlled system message supplies the full menu and requires it to be the sole source of items, currency, sizes, options, prices, and availability, taking precedence over older prompt examples or customer claims. Unlisted items or prices must be acknowledged as unknown rather than invented. Sample status and menu notes are preserved. Missing files, malformed JSON, empty menus, duplicate item IDs, or invalid item/size/option prices return a generic 500 error without invoking the reply function. Request fields cannot replace the server menu.

Successful responses also include a generated `sessionId` and an `order` object. Reuse the returned `sessionId` in subsequent requests to retain that draft. Omit it to start a separate session. Sessions live only in this server process, expire after 30 minutes of inactivity, and are lost on restart; at most 1000 sessions are retained. Unknown/expired session IDs return 404 and malformed IDs return 400. Keep IDs private because they grant access to the draft; they are not authenticated customer accounts.

An optional `order` update tracks the structured draft. For example:

Every successful chat response includes `orderSummary`, a concise description of the current draft's items, quantities, sizes, selected customization names, and sample subtotal before tax and fees. Applied promotions show their name, discount, and discounted subtotal separately. Empty drafts are identified explicitly. Customer contact details are omitted.

To receive the summary as the chatbot's reply without an AI call, send `POST /api/chat` with `{ "message": "What is in my order?", "sessionId": "use-the-returned-ID", "summary": true }`. The reply uses `mode: "order"`. A standalone summary request does not edit order contents (current menu prices are still refreshed under the existing session behavior). If combined with an item action or missing-choice response, that action's acknowledgment or question remains the reply, and `orderSummary` describes the resulting draft. `summary` must be a boolean if supplied. The frontend is unchanged.

To append a single item to the current draft, use `order.addItem` instead of replacing `items`:

For recommendations, send `recommend: { "category": "coffee", "dietary": "vegan", "maxPrice": 5 }` alongside `message` and optionally `sessionId`. All filters are optional and combined; category uses the menu category ID, dietary is one of `vegetarian`, `vegan`, or `gluten_free`, and maxPrice limits the default-size unit price in menu currency. Unknown categories or no matches return no suggestions. `recommend: true` or `{}` asks for a preference before suggesting products; `false` disables this action.

Replies use `mode: "recommendation"` and include at most two `recommendations` with menu IDs, names, prices, and currency. Only items with `available: true` can be selected, in menu order among matches. Text is neutral, never adds products to the draft, and does not claim allergy-safe preparation. Item actions, missing-choice questions, and explicit order summaries take priority if combined in the same request. Menu prices still refresh under existing session behavior. The frontend remains unchanged.

Adding items:

```json
{
  "message": "Add two espressos",
  "sessionId": "use-the-ID-returned-by-the-server",
  "order": { "addItem": { "itemId": "house-espresso", "quantity": 2, "options": ["extra-shot"] } }
}
```

This action appends one line, validates it against the current menu, calculates prices on the server, and returns a direct acknowledgment with `mode: "order"`. Unknown/unavailable items, invalid quantities, sizes, options, duplicate options, and client price fields are rejected. Missing quantity or a size with no menu default returns HTTP 200 with `needsInput: true`, `requiredFields`, a question in `reply`, and the unchanged order. Menu options marked `required: true` must be selected; the current sample menu has only optional add-ons. Resend the complete `addItem` payload with the requested choices and returned session ID; partial additions are not stored. Additions cannot be combined with replacing lines or confirming the draft. This action adds no removal or checkout behavior.

For the existing structured draft fields:

To modify an existing line, use `order.modifyItem` with its zero-based position in the returned `order.items` array. This identifies the intended line even if the same menu item appears more than once:

```json
{
  "message": "Make the first drink large with an extra shot",
  "sessionId": "use-the-ID-returned-by-the-server",
  "order": { "modifyItem": { "lineIndex": 0, "quantity": 2, "size": "Large (16 fl oz)", "options": ["extra-shot"] } }
}
```

Provide at least one of `quantity`, `size`, or `options`. Omitted fields retain their current values; `options` replaces the selected add-ons, and `[]` clears optional add-ons. The menu item ID cannot be changed through this action. Quantities must remain positive integers from 1 to 100, and sizes/customizations must be listed for that available item. Invalid changes leave the draft intact; missing required options return a question with `needsInput: true`. Successful edits recalculate prices/totals and reset confirmation when the draft changes, with a direct reply and `mode: "order"`. Modification cannot be combined with adding, replacing, or confirming items. No removal or checkout is performed.

Other structured draft fields:

To remove an existing line, send `order: { "removeItem": { "lineIndex": 0 } }` with the session ID. To reduce its quantity by a specific amount, send `order: { "removeItem": { "lineIndex": 0, "quantity": 2 } }`. The quantity is the number of units to remove, not the resulting quantity; removing all remaining units deletes the line. It must be a positive integer no greater than that line's current quantity. To set a lower remaining quantity directly, the existing `modifyItem.quantity` action also works.

Removal targets a zero-based position in the latest returned items array. After a line is deleted, following indices shift, so use the updated array for the next action. Totals recalculate and confirmation resets; customer details, fulfillment preference, promotion tracking, and surviving options are retained. Invalid requests leave the draft intact. Removal cannot be combined with adding, modifying, replacing, or confirming the draft. Responses use `mode: "order"`; no checkout or database write occurs.

Other draft updates:

Confirmation gate: request the complete final summary with `review: true`. Only a complete draft returns a non-null `confirmationToken`. After the customer explicitly approves that displayed summary, send `order: { "confirmed": true, "confirmationToken": "the-token-from-that-review" }` with the same session ID in a later request. Do not set that flag based on an ambiguous response. Conversation text alone, including “yes,” never confirms the draft; the client must collect explicit approval before sending the structured confirmation action.

The token is bound to that session and exact reviewed items, customization names/charges, fulfillment details, applied promotion, and calculated totals. Changed drafts, changed menu customization details, wrong tokens, and missing reviews cannot confirm. Obtain a fresh review/token after edits. Incomplete reviews return a null token. Model replies cannot set confirmation. Once this gate passes, the explicitly confirmed snapshot is saved locally as described below; nothing is submitted or paid.

Successful explicit confirmation appends a record to `data/orders.json` and returns `savedOrder: { "id": "unique-UUID", "timestamp": "UTC-ISO-timestamp", "status": "confirmed" }`. Each record contains those fields plus the complete structured order snapshot, marked confirmed. Drafts, ambiguous replies, reviews alone, missing tokens, stale approvals, and incomplete orders are never persisted as confirmed orders. The working session remains editable; saved snapshots remain unchanged by later draft edits, which require fresh review and approval to save a new snapshot.

Repeated confirmation of the same snapshot in the same session returns the existing saved ID without adding a duplicate, even after a new review token is issued. Persistence serializes writes within one server process, writes a temporary file, and atomically replaces the order file. Malformed existing storage is rejected rather than overwritten. Save failures return a generic 500 error and no success acknowledgment; the valid confirmation remains in memory so the same request can be retried after storage is repaired. This JSON storage is for a single local development server; it does not coordinate multiple processes. Saved customer details remain private backend data and are not exposed through a list endpoint.

For a complete review before checkout, send `{ "message": "Review my draft", "sessionId": "use-the-returned-ID", "review": true }`. The response contains `reviewSummary` and a readable review in `reply`, with `mode: "order"`. `reviewSummary.items` includes line index, menu ID/name, quantity, size, customization IDs/names/charges, unit price, and line amount. `fulfillment` includes the selected order type and customer name, plus optional requested pickup time or the delivery phone, full address, apartment/unit, instructions, and address approval. `promotions` contains only the server-validated applied promotion. `totals` includes currency, subtotal, discount, discounted subtotal, tax rate/amount, delivery fee, total, and sample/configured status.

The review retains unanswered values as null and explicit “none” as empty strings. `missingFields` identifies remaining requirements, and `readyForConfirmation` indicates completeness only, not permission to submit an order. `placed` remains false. Review responses do not confirm or place the order; they use freshly validated session data and backend calculations. If combined with an update, the review shows its result; invalid updates remain rejected. `review` must be a boolean. Complete review responses contain the customer's fulfillment details only for the requested session; the existing concise `orderSummary` stays unchanged.

After all delivery details are collected, CaféBot repeats the full `customer.address` and `delivery.apartment` and asks whether they are correct. The response has `needsInput: true` and `requiredFields: ["delivery.addressConfirmed"]`. Explicit customer approval is recorded with `order: { "delivery": { "addressConfirmed": true } }` in a separate request using the same session ID. A plain chat message does not automatically approve an address. If the customer corrects the address or apartment/unit, send those fields instead; the corrected address is saved, repeated back, and requires fresh approval. Changes to order type also reset address approval.

Address changes cannot be combined with approving that changed address. A general draft confirmation (`order.confirmed`) is blocked until the delivery details are complete and `delivery.addressConfirmed` is true. Address approval is separate from draft approval and does not place an order or verify delivery availability. The address is repeated only within its own session's review response; phone and name are not included in that response.

Select delivery with `order: { "orderType": "delivery" }`. The selection and valid partial answers are saved in the session. CaféBot asks only for missing `customer.name`, `customer.phone`, `customer.address`, `delivery.apartment`, and `delivery.instructions`. The address question requests the full street/building address, city, and postal code where applicable. Addresses are customer-supplied text, not verified or inferred from phone numbers or cafe location.

Send partial updates with the same session ID, for example `order: { "customer": { "name": "Alex", "phone": "503-555-0100", "address": "24 Maple Street, Portland OR 97205" }, "delivery": { "apartment": "Unit 4B", "instructions": "Ring bell" } }`. Omitted fields retain their stored values. Phone numbers accept 7–15 digits with common formatting, without assuming a country code. Apartment/unit has a 100-character limit; instructions and address each have a 500-character limit. Invalid input returns 400 without changing the draft.

`delivery.apartment` and `delivery.instructions` start as `null` (unanswered). If the customer explicitly says no apartment/unit or no special instructions, send an empty string for that field. Do not convert silence into an empty string; null remains a missing answer. Delivery drafts cannot be confirmed until the name, phone, address, and explicit answers for apartment/unit and instructions are collected. Updates reset confirmation when details change. Details remain in session memory; no delivery submission, fee estimate, address lookup, database, or frontend change is added.

Select pickup with `order: { "orderType": "pickup" }`. The selection is saved immediately. If `customer.name` is missing or blank, the response has `needsInput: true` and `requiredFields: ["customer.name"]`, asking only for that missing name. Complete it with `order: { "customer": { "name": "Alex" } }` and the same session ID. A name already stored in the draft is reused; pickup does not require phone or address. Pickup drafts cannot be confirmed without a name.

Optional `order.pickupTime` stores a requested local time as `HH:MM` in 24-hour format, for example `"15:30"`. Send `null` to clear it or leave it unspecified. Omitted time retains the existing value. It can be supplied alongside pickup selection or in a later request; invalid times return 400 without changing the draft. When the time is already supplied, the missing-name question does not ask for it again. Time is a preference requiring staff verification, not a reserved slot or readiness promise. Changing pickup details resets draft confirmation. No checkout or submission is added, and the frontend remains unchanged.

```json
{
  "message": "Please update my draft",
  "sessionId": "use-the-ID-returned-by-the-server",
  "order": {
    "items": [{ "itemId": "house-espresso", "quantity": 2, "options": ["extra-shot"] }, { "itemId": "butter-croissant", "quantity": 1 }],
    "orderType": "pickup",
    "customer": { "name": "Alex" },
    "promotion": "coffee-and-croissant"
  }
}
```

`items` replaces the draft's lines; `[]` clears them. Each line has `itemId`, quantity (integer 1–100), optional exact size name, and optional unique option IDs. Missing size selects the menu's default. Item names and all prices are rebuilt from the current menu on every request; unknown/unavailable items and unlisted sizes/options are rejected. `orderType` is `pickup`, `dine_in`, `delivery`, or `null`, recording a preference without promising fulfillment. Customer fields are optional `name`, `phone`, and `address`; omitted fields retain previous values and empty strings clear them. Never include payment credentials.

The endpoint reloads and validates `data/promotions.json` on every valid request. Missing, malformed, currency-mismatched, or unsupported rules return a generic 500 error. Only active promotions with every eligibility condition satisfied by available order items can be recommended or applied. Unknown conditions fail closed. Discounts use the actual selected base-size prices, exclude optional add-ons, honor unit limits and discount caps, and round half-up to cents. No discounts are inferred from customer messages.

Send `recommendPromotions: true` to receive the single best eligible sample promotion in `promotionRecommendations`, without applying it. An empty result means none qualifies. Send `order: { "promotion": "auto" }` to apply the best eligible discount, or provide a promotion ID to validate that it qualifies before selecting the best discount. Unknown, inactive, or ineligible IDs return 400 without changing the draft. `null` removes the discount. At most one promotion applies; greatest discount wins, with ascending ID as the tie-breaker. The applied promotion has `status: "applied_sample"`, not live business approval.

`subtotal` includes quantities, size prices, and option charges. `discount` is the validated promotion amount; `discountedSubtotal` is subtotal minus discount. `tax` and `deliveryFee` come from server configuration, and `total` is discountedSubtotal + tax + deliveryFee. Existing discounts are rechecked after every request: changes to order quantities, menu prices, or promotion activity/eligibility recalculate or remove them. Confirmation resets when the draft or calculated amounts change. Client totals and status cannot be set. States are `empty`, `draft`, and `confirmed_draft`. After reviewing a draft with items and an order type, send `order: { "confirmed": true }` in a separate request. Confirmation records draft review only, without placing an order.

Pricing is configured in `data/pricing.json`, reloaded on each valid request:

```json
{ "is_sample": true, "currency": "USD", "tax_rate_percent": 0, "delivery_fee": 0 }
```

The initial zero values are explicit sample configuration. Set a tax percentage (0–100, up to two decimal places) and a nonnegative flat delivery fee in the menu currency. Monetary values must have cent precision. Tax applies to the discounted item subtotal including add-ons, rounds half-up to cents, and excludes the delivery fee. The delivery fee applies only to nonempty delivery drafts; pickup, dine-in, and empty drafts have no delivery fee. This is a simple calculation policy to configure for the cafe, not a determination of applicable tax requirements. Missing or invalid pricing configuration returns a generic 500 error; unknown fees are not guessed.

All line prices and totals are calculated on the backend using integer cents and validated menu choices. The language-model context requires quoting the supplied amounts exactly instead of performing arithmetic. Model-supplied numeric fields and order objects cannot override the returned server state. Summaries show tax, delivery fee when applicable, and the total, marked `sample_total` when sample pricing is configured. The frontend remains unchanged.

The current order is supplied to the responder as data alongside the system prompt and menu. Order updates are validated and stored before generating a reply; a responder failure does not undo a valid update. Invalid updates leave the previous draft intact. Chat text and model replies do not automatically mutate order state.

The default menu assistant uses deterministic interpretation and current menu data; it does not run an AI model. There is no AI API call, café submission tool, database, authentication, or saved conversation. Working order state is kept in memory; only explicitly confirmed snapshots are persisted to `data/orders.json`. The frontend calls this endpoint on the same origin and keeps its session ID only in memory. On an expired session it reports the error and clears the expired ID so the customer can retry in a fresh session. `.env.example` is not loaded by this server.

Run checks:

```text
node --test backend/audit.test.js backend/server.test.js backend/order-state.test.js backend/order-summary.test.js backend/recommendations.test.js backend/promotions.test.js backend/pricing.test.js backend/order-store.test.js
```
