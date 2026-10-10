---
name: ui-ux
description: Design, implement, or review user interfaces and user flows for websites and apps. Use for UI/UX improvements, responsive layouts, interaction design, and usability reviews; use Figma-specific skills alongside this skill when working in Figma.
---

# UI/UX

Create interfaces that make the user's primary task clear, efficient, and visually coherent. Adapt the depth of work to the request: a small component fix should remain a small fix.

## Establish the direction

Inspect the existing interface, code, design system, and relevant project instructions before proposing changes. Identify the intended audience, primary action, content, and platform from the available context. Ask only about missing decisions that materially change the result; otherwise state a reasonable assumption and proceed.

Preserve established branding, components, and patterns unless the user requests a redesign. For a new interface, choose a coherent visual direction based on the product and content rather than adding decorative trends by default.

## Design and implement

- Prioritize the main action through hierarchy, placement, and clear labels. Group related information and reduce competing calls to action.
- Use a consistent spacing scale, readable typography, restrained colors, and reusable components. Prefer existing tokens; introduce new ones only when justified.
- Design around realistic content, including long titles and variable amounts of data. Avoid placeholder controls that appear functional but do nothing.
- Make layouts adapt to narrow and wide screens. Check wrapping, overflow, navigation, and touch targets; do not rely only on shrinking a desktop layout.
- Include the states relevant to the interaction: loading, empty, error, success, disabled, selected, and focus. Preserve input on recoverable errors and explain how to continue.
- Use semantic controls, accessible names, visible keyboard focus, logical navigation order, and sufficient contrast. Do not convey meaning through color alone. Respect reduced-motion preferences when adding animation.
- Follow the project's framework and component conventions. Wire up requested interactions and keep changes within the requested scope.

When the user requests Figma work, load the applicable available Figma skills before their tools. Do not create or modify a Figma file merely because a UI/UX task mentions design.

## Review an existing experience

Trace the primary user flow and inspect the actual interface when available. Separate observed problems from hypotheses that require user research or analytics.

Prioritize findings by their impact on task completion, accessibility, comprehension, and recovery. For each material issue, identify the affected screen or component, explain the user consequence, and propose a specific correction. Avoid presenting personal aesthetic preferences as usability defects.

Implement fixes when requested. For review-only requests, provide actionable findings without changing files.

## Verify and deliver

Use the available preview or browser tools to inspect the rendered result when possible. Exercise the primary interaction, check representative narrow and wide layouts, and verify relevant keyboard and error states. Run project checks appropriate to the code changed. Report verification limits accurately; do not claim visual or accessibility validation from code inspection alone.

Deliver the completed artifact or changes with a concise explanation of the main design decisions and what was verified. Identify any remaining functional limitations that affect use.
