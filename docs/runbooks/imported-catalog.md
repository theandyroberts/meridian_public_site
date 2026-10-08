# Approved imported catalog (staging)

This branch connects the existing composite ingest/review design to the normal catalog and `/plate/[sku]` pages. The public coming-soon deployment is separate and remains unchanged.

The import adapter preserves MMM stock IDs, verified source hashes, frame rate, timecode, source color limitations, preview coverage and tags. One existing matching stock clip retains its SKU/UUID. The eight replaced demonstration records become drafts; they and their media are retained. The limited RLS policy permits a retired plate to remain readable to existing full-access project members only. Public catalog queries explicitly require `live`.

Approved metadata snapshots are stored outside Git under the existing media mount:
`/srv/platelab-coolify/public-media/imported-catalog/approved-imports-20261008/<id>.json`.
Each catalog record contains a source-bound reference. The server checks ID, source fingerprint and approval timestamp before rendering. Approval covers all 16 imported clips and their 1,420 effective observations, including the source-bound scene/mood editorial layer. Warnings about physical synchronization, estimated telemetry, coverage and third-party rights remain facts; editorial approval does not erase them.

Media remains on the existing ingest volume. A narrow Next rewrite proxies `/composite-review/media/*` from the existing public review host, so video, evidence and WebGL previews remain same-origin inside the staging access gate. No original media is moved, copied into Git or deleted. HTTP Range behavior must be checked after deployment.

The imported detail page uses the existing CompositeDetail/CompositePlayer components, including Lab 360, panoramic and full-screen modes, synchronized timeline/GPS/IMU, evidence highlights and category/tag search. Catalog mode shows persisted approvals and a read-only selected poster; it does not write browser-only review choices or send feedback email. The original review app remains separate. Project Studio links select `/imported-stage` for an imported plate and carry its actual coverage limit. The existing `/stage` build is preserved for old project selections.

The checked-in imported-stage bundle comes from `viewer/`; regenerate with `npm run build:imported --prefix viewer` after installing viewer dependencies. Web uses Three.js for the vehicle-attitude component.

## Deployment and rollback

Deploy the new application before promoting catalog records. Install the approved snapshots first, preserving the existing media bind mount. Apply the catalog promotion in one transaction, with exact input identity guards, 16-live/8-retired counts and RLS checks; retain all six existing scene selections. The catalog migration is not run automatically by the app build.

Server-only before-state backup:
`/srv/platelab-coolify/catalog-backups/approved-imports-20261008`.
It contains prior catalog tables, the app image/mounts, approval receipts and the promotion SQL. For rollback, restore only affected old catalog row values/metadata and deactivate newly introduced rows; retain any new project references. Restore app branch `codex/staging-domain-migration`, commit `cb8db2befdc6dadc34f1af2820fc6049166988b1`. Do not restore a whole database, delete imported media, or change passwords/DNS/mail.

Validation: web tests, Next production build, rollback-only database trial and RLS checks, then live catalog counts/search/detail/media-range/360/evidence checks. Embedding jobs are queued; keyword and tag search do not require embeddings. Existing staging has no configured OpenAI embedding worker credentials in its web container.
