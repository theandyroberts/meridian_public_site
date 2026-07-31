# Project Detail Design QA

## Evidence

- Source visual truth:
  `docs/qa/project-detail-source.png`
- Browser-rendered implementation:
  `docs/qa/project-detail-implementation.jpg`
- Open project editor:
  `docs/qa/project-editor-implementation.jpg`
- Full-view comparison:
  `docs/qa/project-detail-comparison.jpg`
- Focused scene-region comparison:
  `docs/qa/project-detail-scenes-comparison.jpg`
- Route:
  `https://staging.theplatelab.site/projects/f4de71af-7434-480d-8edb-b87f3a9d9c8d`
- State:
  Authenticated project owner; eight-scene project; editor closed for the
  primary comparison and open for the interaction check.

## Normalization

- Source capture: 3134 × 1508 pixels, representing approximately
  1567 × 754 CSS pixels at 2× density.
- Implementation capture: 1316 × 768 pixels at the active Safari window
  density.
- Implementation content comparison crop: 1316 × 698 pixels after removing
  70 pixels of Safari chrome.
- Full comparison: both content surfaces normalized to 1200 pixels wide and
  placed in one 2400 × 636 comparison image.
- Focused comparison: source scene region and implementation table region
  normalized to 1200 pixels wide and placed in one 2400 × 584 image.
- The source is the existing Plate Lab visual-language reference, not an
  exact layout target. The requested table density and private-title behavior
  are intentional deviations.

## Full-View Comparison

The implementation preserves the source's ink field, paper typography,
orange telemetry labels, square controls, hairline borders, wide desktop
composition, project/add-scene hierarchy, and restrained accent use. The
project heading is intentionally shorter and the scene area starts higher,
allowing seven complete rows to remain visible above the fold at 1316 × 768.

## Focused Scene Comparison

The former narrative rows showed roughly two scenes in the same vertical
space. The new table shows seven complete rows with dedicated columns for
sequence, script scene, page, scene title, plate brief, vehicle, search
status, and the open action. Long narrative content is intentionally
single-line truncated so the table retains production-sheet density.

## Required Fidelity Surfaces

- Fonts and typography: Existing Hanken Grotesk and IBM Plex Mono tokens are
  retained. Display, form, table-heading, and telemetry weights remain
  consistent with the source. Table text is compact but readable.
- Spacing and layout rhythm: The heading and section gaps are reduced without
  crowding. The 56-pixel row height produces the requested above-the-fold
  density. The add-scene form remains aligned as a stable right rail.
- Colors and visual tokens: Existing ink, paper, horizon orange, semantic
  ready green, and hairline tokens are reused; no ungrounded palette changes
  were introduced.
- Image quality and asset fidelity: No new raster assets, illustrations, or
  icons were required. The existing brand mark remains unchanged.
- Copy and content: `BLACKLIST_MOVIE` is the normal visible identity.
  `Knives Out` appears only after explicitly opening Edit project. The editor
  explains the privacy boundary in plain language.

## Interaction Checks

- Opened the authenticated project from the project list.
- Confirmed the migrated working title is used on both project list and
  detail heading.
- Opened the Edit project disclosure.
- Confirmed working title, optional private actual title, client, due date,
  and internal notes are editable.
- Confirmed every scene has a named open link and the add-scene form remains
  available beside the table.
- Database update behavior was verified separately through the staging SQL
  access test.

## Findings

No actionable P0, P1, or P2 findings remain.

## Comparison History

- Initial implementation comparison: passed. The visual changes from
  narrative rows to a dense table and from actual title to working title are
  the requested product changes, not fidelity drift.
- No P0/P1/P2 fixes were required after the browser-rendered comparison.

## Follow-Up Polish

- P3: A future table iteration could expose user-configurable column widths
  or saved sorting once production teams establish which metadata they scan
  most often.

final result: passed

# Scene Number Column Width Design QA

## Evidence

- Source visual truth:
  `docs/qa/scene-number-column-source.png`
- Browser-rendered implementation:
  `docs/qa/scene-number-column-implementation.jpg`
- Focused side-by-side comparison:
  `docs/qa/scene-number-column-comparison.jpg`
- Route:
  `https://staging.theplatelab.site/projects/38600927-e4dd-4807-8598-08f0dab9401e?imported=9`
- State:
  Authenticated project workspace with nine imported scenes and both scene-input
  panels collapsed.

## Normalization

- Source capture: 226 × 1042 pixels, a Retina-density crop of the original
  narrow Scene # column.
- Implementation capture: 1316 × 768 pixels at the active Safari viewport.
- Focused source and implementation crops were normalized to 360 pixels high
  and placed in one comparison image. The comparison evaluates the table
  header and populated Scene # cells rather than surrounding browser chrome.

## Full-View Comparison

The full staging capture preserves the dense project-table layout while giving
the Scene # column enough room to avoid stealing meaningful space from Scene
or Plate brief.

## Focused Region Comparison

The original column wrapped `Scene #` and truncated `42, 44, 46`. The revised
112px column keeps `Scene #` on one line and displays all three imported scene
numbers without an ellipsis.

## Required Fidelity Surfaces

- Fonts and typography: Existing IBM Plex Mono table typography, weight,
  letter spacing, and size are unchanged; only wrapping is prevented.
- Spacing and layout rhythm: The Scene # track grows from 72px to 112px while
  table row heights, cell padding, and adjacent column alignment remain intact.
- Colors and visual tokens: No color or state-token changes.
- Image quality and asset fidelity: No visible raster or icon assets are part
  of this table-width change; the browser capture is sharp enough to verify
  header wrapping and cell truncation.
- Copy and content: `Scene #` remains the header and `42, 44, 46` is fully
  visible in the longest populated row.

## Findings

No actionable P0, P1, or P2 findings remain.

## Comparison History

- P2 source finding: the header wrapped and multi-scene values were truncated.
- Fix: increased the second table track to 112px and set the header to
  `white-space: nowrap`.
- Post-fix evidence: the live staging focused comparison shows the header on
  one line and the longest imported value without truncation.

## Follow-Up Polish

No P3 follow-up is required for this scoped change.

final result: passed

---

# Scene Workspace Controls Design QA

## Evidence

- Source visual truth:
  `docs/qa/scene-workspace-controls-source.png`
- Browser-rendered implementation:
  `docs/qa/scene-workspace-controls-implementation.jpg`
- Combined comparison:
  `docs/qa/scene-workspace-controls-comparison.jpg`
- Route:
  `https://staging.theplatelab.site/projects/38600927-e4dd-4807-8598-08f0dab9401e?imported=9`
- State:
  Authenticated project owner; nine imported scenes; both scene-entry panels
  closed.

## Normalization

- Source capture: 2852 × 1674 pixels at the submitted screenshot density.
- Implementation capture: 1316 × 768 pixels at the active Safari density.
- Both captures were constrained to 1200 × 900 without upscaling and placed in
  one 2400 × 704 comparison image.
- The implementation capture uses the live authenticated staging data with the
  code-equivalent closed-panel layout applied for pre-deployment visual QA.

## Full-View Comparison

The revised workspace removes both persistent entry forms, gives the nine-scene
table the full available width, and keeps every scene above the fold. The
project heading, success notice, table columns, and footer retain the existing
light Lab composition.

## Focused Scene-Table Comparison

The source rows inherited a dark translucent wrapper and read as disabled. The
implementation gives the wrapper and every resting row the Lab cream surface,
while preserving hairline dividers, green search readiness, and the existing
orange hover state. `Import` and `+ Add scene` are now adjacent controls beside
the scene total.

## Required Fidelity Surfaces

- Fonts and typography: Existing Hanken Grotesk body/table text and IBM Plex
  Mono metadata remain unchanged. Dense single-line truncation is preserved.
- Spacing and layout rhythm: The table expands to one full-width column when no
  panel is open. Controls align with the scene total and do not add a new row.
- Colors and visual tokens: Resting rows now use `var(--ink-2)` (`#fffdf9`) and
  retain `var(--orange-soft)` on hover.
- Image quality and asset fidelity: No new imagery or icon assets were needed;
  the existing Plate Lab logo remains unchanged.
- Copy and content: The controls read `Import` and `+ Add scene`; scene count,
  metadata, descriptions, and search-term status are unchanged.

## Interaction Checks

- Confirmed both controls are exposed as collapsed buttons in the Safari
  accessibility tree.
- The client component enforces a single `import | add | null` state, so opening
  either panel closes the other and clicking the active control closes it.
- Existing `#add-scene` deep links still open the manual form on mount.
- The complete web test suite and production build pass.
- A live click-through was interrupted when the active Safari window changed;
  this remains a P3 verification gap rather than a visible or structural issue.

## Findings

No actionable P0, P1, or P2 findings remain.

## Comparison History

- Source finding (P1): dark resting rows communicated a disabled table state.
- Source finding (P2): simultaneous manual and import forms consumed most of
  the workspace and duplicated the scene-entry decision.
- Fix: set explicit cream resting surfaces and move both forms behind mutually
  exclusive scene-entry controls.
- Post-fix comparison shows an active cream table and no form competing with
  the scene list.

## Follow-Up Polish

- P3: Capture automated screenshots of the Import-open and Add-scene-open states
  after the next staging deployment.

final result: passed

---

# Authenticated Header Refinement Design QA

## Evidence

- Source visual truth:
  `docs/qa/authenticated-header-audie-source.png`
- Browser-rendered implementation:
  `docs/qa/authenticated-header-audie-implementation.png`
- Combined comparison:
  `docs/qa/authenticated-header-audie-comparison.png`
- Route:
  `https://staging.theplatelab.site/projects`
- State:
  Authenticated project owner with one active project and the corrected profile
  name `Audie`.

## Normalization

- Source capture: 908 × 1006 pixels at the submitted screenshot density.
- Implementation capture: 1316 × 768 pixels at the active Safari density.
- Combined comparison: both images constrained to 900 pixels on their longest
  side and placed in one 1712 × 900 canvas.
- The source is an annotated crop rather than a pixel-exact mock. The comparison
  therefore evaluates the three explicit targets: `Projects (1)`, a non-action
  signed-in status, and `Audie` as the visible identity.

## Full-View Comparison

The implementation retains the existing Plate Lab header height, logo,
navigation rhythm, and dark/light workspace boundary. Removing the account
group's outer border does not disturb the page frame or project-table density.

## Focused Header Comparison

The project count appears beside the persistent Projects link. `Signed in` and
`Audie` are now unboxed status text, while the separate `Log out` control keeps
the horizon-orange action outline. This resolves the annotated ambiguity
without introducing a new component treatment.

## Required Fidelity Surfaces

- Fonts and typography: Existing Hanken Grotesk and IBM Plex Mono treatments
  remain unchanged; the stacked status/identity hierarchy stays legible.
- Spacing and layout rhythm: A 14-pixel gap separates status from the outlined
  action while preserving the established navigation spacing.
- Colors and visual tokens: Existing ink, paper, muted-paper, and horizon-orange
  tokens are reused.
- Image quality and asset fidelity: No new image or icon asset was required; the
  existing Plate Lab logo is unchanged.
- Copy and content: The browser state visibly reads `Projects (1)`, `Signed in`,
  `Audie`, and `Log out`.

## Interaction Checks

- Confirmed the live authenticated session resolves the updated profile name.
- Confirmed the active project query returns one project and the same value is
  presented in the header preview.
- Confirmed Projects remains a named link and Log out remains a distinct named
  button in the accessibility tree.
- Did not submit Log out, preserving the authenticated QA session.
- No new console errors appeared during the header preview.

## Findings

No actionable P0, P1, or P2 findings remain.

## Comparison History

- Source finding (P2): the orange border grouped passive account status with an
  action and made the identity resemble a button.
- Fix: removed the group border, retained the border only on Log out, added the
  active-project count, and corrected the profile record to `Audie`.
- Post-fix browser evidence shows all three requested changes with no remaining
  P0/P1/P2 issue.

## Follow-Up Polish

- P3: Add this authenticated header state to the future automated responsive
  screenshot suite.

final result: passed

---

# Authenticated Header Design QA

## Evidence

- Source visual truth:
  `/var/folders/mq/2l9529213mqf0_sng1n02nlc0000gn/T/com.openai.sky.CUAService/Safari Screenshot 2026-07-31 at 10.21.15 AM.jpeg`
- Browser-rendered implementation:
  `/var/folders/mq/2l9529213mqf0_sng1n02nlc0000gn/T/com.openai.sky.CUAService/Safari Screenshot 2026-07-31 at 10.50.02 AM.jpeg`
- Route:
  `https://staging.theplatelab.site/projects`
- State:
  Authenticated production-company user with the saved profile name
  `Start_Project`.

## Normalization

- Source and implementation captures are both 1316 × 768 pixels from the
  same Safari window and density.
- The source route is `/projects/new` and the implementation route is
  `/projects`; the relevant shared site-header region is the same width,
  theme, session, and navigation state.
- Full-view review checked that the header change did not disturb the page
  frame. Focused review used the shared header region because that is the only
  requested visual surface.

## Full-View Comparison

The header retains the logo position, 72-pixel bar, dark glass treatment,
navigation rhythm, paper text, and horizon-orange border treatment. The
Projects workspace remains aligned to the existing light Lab canvas.

## Focused Header Comparison

`Projects` remains a persistent primary link. The former `Start a project`
CTA is replaced for authenticated users by a bordered account block containing
an explicit `Signed in` state, the saved user name, and a separate `Log out`
button. The final iteration stacks the state label over the identity so the
full `Start_Project` name remains visible rather than reading like the former
CTA.

## Required Fidelity Surfaces

- Fonts and typography: Existing Hanken Grotesk navigation and IBM Plex Mono
  account-label treatments are preserved. The account state uses the smaller
  telemetry scale already present in the brand system.
- Spacing and layout rhythm: The account group reuses the former CTA height and
  border placement, preserving header balance and existing nav gaps.
- Colors and visual tokens: Existing paper, muted-paper, ink, hairline, and
  horizon-orange tokens are reused without introducing a new semantic color.
- Image quality and asset fidelity: No new image or icon asset was required;
  the existing Plate Lab logo remains unchanged.
- Copy and content: `Signed in`, the actual saved profile name, `Log out`, and
  `Projects` are all visible simultaneously. Logged-out users retain the
  existing `Start a project` CTA.

## Interaction Checks

- Confirmed the authenticated header renders from the live Supabase session.
- Confirmed the profile name is read from the authenticated user's profile and
  has metadata/email fallbacks covered by unit tests.
- Confirmed `Projects` is a named link and `Log out` is a named form button in
  the staged accessibility tree.
- Did not submit Log out during QA, preserving the user's authenticated Safari
  session; the action reuses the existing tested Supabase sign-out server
  action.

## Findings

No actionable P0, P1, or P2 findings remain.

## Comparison History

- Pass 1 finding (P2): the saved profile name `Start_Project` visually
  resembled the former Start a project CTA and was not an unambiguous login
  indicator. Added the explicit `Signed in` label.
- Pass 2 finding (P2): the inline state label compressed and truncated the
  visible profile name. Stacked the state label above the identity and widened
  the desktop identity allowance.
- Pass 3: the browser-rendered staging comparison shows the full saved name,
  explicit authenticated state, persistent Projects link, and adjacent Log out
  action with no remaining P0/P1/P2 issue.

## Follow-Up Polish

- P3: When a dedicated mobile visual-regression harness is added, capture the
  compact breakpoint as a separate golden image. The implemented breakpoint
  keeps Projects visible, hides only the secondary catalog links, and truncates
  unusually long account names safely.

final result: passed

---

# Scene Upload Design QA

## Evidence

- Source visual truth:
  `/var/folders/mq/2l9529213mqf0_sng1n02nlc0000gn/T/TemporaryItems/NSIRD_screencaptureui_FFlflb/Screenshot 2026-07-31 at 10.02.34 AM.png`
- Browser-rendered implementation:
  `/var/folders/mq/2l9529213mqf0_sng1n02nlc0000gn/T/com.openai.sky.CUAService/Safari Screenshot 2026-07-31 at 10.21.15 AM.jpeg`
- Route:
  `https://staging.theplatelab.site/projects/new`
- State:
  Authenticated production-company user; new-project screen; scene import idle
  state.

## Normalization

- Source capture: 808 × 482 pixels. It is a generic, full-size modal upload
  reference rather than an exact Plate Lab layout target.
- Implementation capture: 1316 × 768 pixels at the active Safari window
  density.
- The comparison therefore focuses on the upload control's interaction
  hierarchy: dashed target, recognizable file-upload icon, centered primary
  action, and secondary drag/drop/paste guidance.
- Scale is intentionally reduced in the implementation because the upload is
  the third step in a compact, above-the-fold business workflow rather than a
  standalone modal.

## Full-View Comparison

The implementation keeps project identity, script-import instructions, all
three steps, and the manual-entry alternative visible above the fold. The
drop target is visually distinct without competing with the project fields or
the primary Copy prompt action.

## Focused Upload Comparison

The staged target carries forward the source reference's dashed boundary,
centered file icon, strong click action, and drag/drop/paste affordance. Copy
is narrowed to the accepted artifact and operational limit: `JSON` and
`1 MB max`.

## Required Fidelity Surfaces

- Fonts and typography: Existing Hanken Grotesk and IBM Plex Mono brand tokens
  are retained; upload copy is compact and remains legible in the workflow.
- Spacing and layout rhythm: The control fits the established three-column
  import grid and preserves the page's information-dense business layout.
- Colors and visual tokens: Existing paper, ink, horizon-orange, muted-ink,
  and semantic-success tokens are reused.
- Icon fidelity: The upload uses the Phosphor `FileArrowUp` icon rather than a
  text glyph or CSS-drawn substitute.
- Copy and content: The idle state clearly supports click, drag and drop, and
  pasted file input. The accepted format and size limit are visible before
  interaction.

## Interaction Checks

- Clicked the staged drop target and confirmed Safari opened the native file
  picker with the title `Choose Files to Upload`.
- Cancelled the picker without selecting or transmitting a local file.
- Confirmed the control exposes a named button and a file-upload element to
  assistive technology.
- Drag/drop, pasted-file handling, JSON parsing, validation, and ready-state
  rendering are covered by the component implementation and the passing web
  test suite; the staged visual check did not transmit a test file.

## Findings

No actionable P0, P1, or P2 findings remain.

## Comparison History

- Initial staging deployment failed during Coolify's temporary clone cleanup.
  Retrying the unchanged commit completed successfully.
- Browser comparison passed without follow-up UI changes.

## Follow-Up Polish

- P3: Capture a dedicated staged screenshot of the drag-active state if the
  team later formalizes visual regression snapshots for transient states.

final result: passed
