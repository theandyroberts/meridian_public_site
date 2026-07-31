# Lab workspace density constraints

These constraints apply to business and production workflow routes, starting
with `/projects/**`. Media browsing, video preview, and sales surfaces keep the
dark presentation treatment and are outside this specification.

## 1. Task before explanation

- Put the primary task immediately below the global header.
- Do not use a marketing hero, oversized statement, or tutorial paragraph on a
  routine form or record-management page.
- Keep page titles between 30–36px on desktop and 26–32px on mobile.
- Show workflow position as small metadata, never as the page's visual focus.
- Explain only information that prevents a likely error. Put optional guidance
  in a tooltip, disclosure, or empty state.

## 2. Dense, predictable form layout

- Use a 4/8/12/16/24/32px spacing scale. Business workflows must not introduce
  48–72px gaps between related controls.
- Keep one-line controls at 40px on desktop and at least 44px on touch layouts.
- Use 13–14px labels and 11–12px metadata. Important values must be at least
  14px and visually stronger than their labels.
- Put related short fields on one row when space permits. Let the primary field
  receive the most width.
- Size textareas to the expected input, not to fill the page.
- Place the primary action beside the final relevant control. Do not separate it
  with decorative whitespace.

## 3. Records are rows, media are cards

- Default to tables or compact rows for projects, scenes, users, requests, and
  other repeatable business records.
- Show the fields used to identify and triage a record above the fold.
- Reserve large cards for visual media, comparisons, or mutually exclusive
  choices where the card itself carries meaning.
- Keep routine rows between 44–56px tall and preserve a clear hover/focus state.

## 4. Progressive disclosure

- Keep optional setup, bulk import, editing, destructive actions, and advanced
  controls in disclosures, drawers, or compact side panels.
- A closed disclosure must name the action directly (for example, “Edit
  project” or “Enter a scene manually”).
- Do not repeat privacy, onboarding, or workflow explanations after the user has
  reached a familiar working screen.

## 5. Desktop and responsive behavior

- Desktop pages may use the full workspace width when doing so exposes more
  useful records or fields. Reading copy still needs a sensible line length.
- At narrow widths, stack fields and controls without changing their order or
  hiding essential values.
- Allow data tables to scroll horizontally rather than collapsing every record
  into a tall card.
- Maintain visible keyboard focus and a minimum 44px touch target on mobile.

## Acceptance check

For a returning user at a typical laptop viewport, the primary action and the
first useful records or form controls should be visible without scrolling. If a
large region contains neither a decision, an input, nor operational data, it
should be reduced or removed.
