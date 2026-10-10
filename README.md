# Chaigpt2

CafeBot café website with Zara, a local menu-based assistant, built with plain HTML/CSS/JavaScript and a dependency-free Node backend.

- `frontend/`: responsive café landing page, Zara chat, and staff dashboard.
- `backend/`: local website server, menu assistant, validated session orders, totals, and confirmed-order storage.
- `data/`: sample menu, promotions, pricing configuration, and local confirmed orders.
- `prompts/`: CafeBot system instructions for an optional future AI responder.

Run `node backend/server.js` (Node 18+) and open **http://127.0.0.1:3000/**. Click **Talk to Zara** to open the chat. Opening HTML directly or serving it on port 5500 does not run the chat backend. Staff orders are at **http://127.0.0.1:3000/staff**.

Zara answers from `data/menu.json`, including sizes, prices, customizations, availability, and base allergens. Try “add 2 large Americanos”, “change Americano to 1 small”, “remove 1 Americano”, “pickup”, “my order”, or “checkout”. Send one item at a time; ambiguous or unsupported requests ask for clarification. Fulfillment forms collect missing details. Review the final summary, then use **Confirm this sample order** to save locally. Delivery also requires explicit address approval. No AI provider, payment, or café submission is connected; menu and business details are samples. Drafts expire after 30 minutes of inactivity and are lost on server restart or page reload.

See [backend/README.md](backend/README.md) for the structured API and validation rules. Run `node --test backend/*.test.js` for backend checks and `node scripts/audit-chat-connected.cjs` with Playwright and Edge installed for the connected chat browser test. Tests use temporary orders, preserving `data/orders.json`.

Zara remembers the current topic within a server session: “add large Americanos” → “two please”, followed by “make it small” or “remove one of them”. Ambiguous choices such as “two lattes” offer product buttons and retain the requested quantity/size. After a pickup-name question, a simple “Alex” is accepted. Product follow-ups such as “does it have milk?” use the last unambiguous item. Recommendations support hot/iced, dietary, and budget preferences; comparisons quote listed default prices. Switching products or cancelling clears a pending addition. Context is isolated per session and expires after 30 minutes of inactivity. This is still a menu assistant, not a general-purpose AI chatbot.

UI guidance is saved in [design-system/cafebot/MASTER.md](design-system/cafebot/MASTER.md). Review findings, screenshots, verification results, and remaining launch requirements are in [docs/UI-UX-AUDIT.md](docs/UI-UX-AUDIT.md).

Run `node scripts/audit-ui.cjs` when Node, Playwright, and Microsoft Edge are available; the script saves screenshots and results under `docs/ui-audit/`. Business details are samples, and fonts/photos require internet access.
