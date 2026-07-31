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
