# CaféBot implementation design system

Saved: 8 October 2026. Use this document for future CaféBot UI work alongside `frontend/styles.css` and `docs/UI-UX-AUDIT.md`.

This records the existing brand and the adopted UI/UX Pro Max recommendations. It is an implementation specification, not unmodified generated search output. Preserve the current content and working anchor navigation unless a task requests changes.

## Experience and hierarchy

Audience: café visitors browsing the menu, opening hours, and location on phones and desktops. Primary action: **Find your usual**, linking to the menu. Secondary action: **Come on over**, linking to the visit section. Keep story, menu, hours/location, and footer in the existing order. Use native links, a visible skip link, logical headings, and no new UI dependencies by default.

## Color tokens

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#f5f1e8` | Main warm background |
| `--surface` | `#fcfaf5` | Menu card surface |
| `--ink` | `#22251e` | Main text, primary button, dark banner |
| `--muted` | `#626456` | Supporting prose |
| `--orange` | `#e66b36` | Decorative sun, stamp, brand strip |
| `--accent-text` | `#b74b22` | Emphasized hero text and keyboard outlines |
| `--line` | `#d7d5c9` | Decorative dividers and card boundaries |

Normal text pairs must maintain at least 4.5:1 contrast. The dark ink on orange measures 4.83:1; muted text on paper measures 5.36:1. Do not use the brighter decorative orange for small text on cream. Photo captions retain dark backplates. Card borders are decorative, not interactive control boundaries.

## Typography and space

- Hero, invitation banner, menu names, and italic emphasis: Cormorant Garamond, with Georgia fallback. Section headings and wordmark: Manrope, with sans-serif fallback.
- Prose and controls: DM Sans, with Arial/sans-serif fallback. Body 16px; product prose 14–15px; line height generally 1.65–1.85.
- Use fluid headings and balanced wrapping as progressive enhancement. Essential text must wrap naturally even when balancing is unavailable.
- Reuse `--page-gutter`, `--section-space`, and `--radius`. Keep component spacing on a 4/8px rhythm where practical.
- Small labels are secondary, not substitutes for meaningful product names, prices, or control labels.

## Component and responsive rules

- Header: desktop row; dedicated navigation row at 600px and below. Navigation can wrap with enlarged text.
- Hero and story: two columns above 860px; stacked at and below 860px. Keep the hero action visible before decorative content.
- Menu: three columns above 860px; two columns with the last item presented horizontally from 601–860px; one column at 600px and below.
- Menu cards: portrait image region uses a reserved .96 aspect ratio; image fills that region absolutely. Card body groups name, price, description, and category. Numbered photo corners, serif product names, and subtle cream surfaces create an editorial treatment. Cards are informational and must not look like unsupported purchase controls.
- Visit details: content-driven rows that wrap. Hours must not depend on unbreakable text.
- All links: at least 44×44 CSS pixels as this project's usability target. This is a project choice, not a statement that WCAG AA universally requires that size.
- Keyboard outlines stay visible. Hover and pressed states change color/decoration without shifting layout.
- Motion: use the shared `--interaction-time` token where appropriate; respect reduced motion. Avoid introducing animations or a carousel without a task requirement.
- Photography: keep existing assets and descriptive alternatives; retain dimensions, `srcset`, `sizes`, async decoding, and lazy loading below the fold. Keep hero loading prioritized.
- Do not hide overflow to conceal layout defects. Allow prose, navigation, badges, and hours to reflow under text enlargement and spacing overrides.

## Verification before delivery

Run `scripts/audit-ui.cjs` with Playwright and installed Edge. Check nine widths from 320 to 1920px; primary anchors; keyboard skip navigation; minimum target dimensions; image aspect ratios; responsive image sources; and reduced motion. Inspect desktop, tablet, and mobile screenshots. Check 200% text enlargement with spacing overrides at 320px.

Full screen-reader testing, other browser engines, real-device testing, and actual browser zoom remain separate manual checks. Confirm sample business details and asset hosting before public release.

## Premium editorial direction

The user requested a more premium presentation after the accessibility work. Retain the cream/terracotta/olive brand while using a larger serif hero, an offset fine-line photo frame, an asymmetric story image, a contrasting sand-colored menu section, and a large decorative wordmark on the dark footer. The brand strip is now cream with fine dividers. Dark footer text uses cream or `#d1cebd`; footer hover/focus uses `#ef8d61`.

The extra hero action, **Plan your visit**, links to the existing visit section. Keep it subordinate to **Find your usual**. The large footer wordmark is hidden from assistive technology because the normal accessible home link remains nearby. Avoid introducing unsupported commerce, fabricated reviews, or artificial scarcity to suggest quality.

## Website and Zara refinement — 10 October 2026

The current website uses a lighter paper background `#f7f4ed`, sand menu background `#ede8db`, and forest `#263629` for the invitation, footer, and customer chat bubbles. Keep `#b74b22` for readable accent text. Serif section headings now extend the hero typography throughout the page. Rounded rectangular photos, restrained card shadows, and generous spacing replace the earlier arch treatment.

Product cards include **Ask Zara about this** buttons. These open the existing assistant with a read-only question about that product. The hero also includes an **Ask Zara** entry point. Closing the panel restores keyboard focus to the control that opened it. The fixed bottom-left launcher and expanded right-side panel remain available; mobile chat occupies the screen.

Editable desktop, mobile, and expanded Zara layouts, brand color variables, text styles, and reusable library controls are saved in [the CaféBot Figma file](https://www.figma.com/design/IWsmYpnPjixOhiyesMhPiZ). The Figma layouts are a design handoff; the implemented website is the reference for exact content, responsive behavior, and working interactions.
