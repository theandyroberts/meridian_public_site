# User Features Execution Outline

**Status:** In progress
**Product:** The Plate Lab / THE LAB
**Architecture plan:** `2026-07-29-user-features-supabase.md`

## Delivery sequence

### 0. Platform readiness

Finish the self-hosted foundation before application data is introduced:

- production Supabase HTTPS, Kong, Auth, Postgres extensions, and Realtime;
- a separate staging Supabase environment;
- production SMTP and Auth email templates;
- persistent Postgres and object-storage volumes;
- automated off-host database and object backups plus a restore drill;
- pinned container versions and basic availability monitoring.

**Exit:** login, email confirmation/recovery, private object access, Realtime,
and restore all work in staging.

### 1. Application and database foundation

- Add pinned Supabase browser, SSR, and privileged server clients.
- Add versioned SQL migrations and generated TypeScript database types.
- Create identity, organization, staff, catalog, project, scene, and audit
  foundations.
- Add RLS helper functions and automated access-policy tests.
- Add login, logout, recovery, callback, and protected-route handling.

**Exit:** an invited staging user can sign in and can read only their own
organization.

### 2. Catalog cutover

- Create stock clip, asset, stage, and mapping-profile tables.
- Build an idempotent JSON-to-Postgres importer and reconciliation report.
- Create public teaser and private LAB-preview buckets.
- Switch public catalog reads and ingest writes together after staging parity.
- Preserve a frozen JSON rollback export for one stable release.

**Exit:** Postgres matches the existing catalog and the public site is visually
and behaviorally unchanged.

### 3. Projects and scenes

- Build the project dashboard and project settings.
- Add project/scene creation, editing, ordering, archive, and restore.
- Add stage, production-approach, vehicle, rough-shot, and search-brief fields.
- Use optimistic versions and explicit autosave/error states.

**Exit:** a pilot owner can create and reopen a project and scenes across
devices without cross-organization access.

### 4. Discovery and collaboration

- Add the canonical `scene_clips` relationship and synchronized status.
- Add full-text search, then semantic ranking as an additive enhancement.
- Add notes, range selections, invitations, and selected-clips review.
- Add private Realtime events and selected-only projection RPCs.

**Exit:** owner, collaborator, and selected-only reviewer pass the access
matrix, with live permitted updates.

### 5. Integrated THE LAB

- Replace local-file/iframe state with authenticated `/lab/[sceneClipId]`.
- Load a signed watermarked preview and approved mapping automatically.
- Persist vehicle, camera, trim, notes, status, and valid in/out frames.
- Keep advanced projection mapping staff-only.

**Exit:** saved viewer and selection state survives refresh and is identical
across search, scene workspace, and THE LAB.

### 6. Producer handoff

- Build the project selection summary.
- Validate selections and create an immutable submission snapshot.
- Add the producer request queue and workflow status.
- Remove reservation and licensing `mailto:` behavior from the customer path.

**Exit:** a producer receives every clip/range/licensing field required to
continue the PO, billing, licensing, and delivery process offline.

### 7. Hardening and pilot

- Complete RLS, integration, browser, media-failure, and accessibility tests.
- Exercise invitation expiry/revocation and signed-URL expiry.
- Complete backup restore and catalog rollback drills.
- Run a small client pilot before wider account availability.

## Ownership split

### Codex-owned work

- repository setup, dependencies, clients, routes, UI, SQL migrations, RLS,
  tests, importers, reconciliation, and documentation;
- local builds and tests;
- deployment configuration values that are not secrets;
- preparation of exact commands or SQL for staging and production changes.

### Andrew-owned work

- actions requiring control of DNS, Coolify, SMTP, backup storage, or private
  credentials;
- choosing/approving sender identity and customer-facing email copy;
- confirming product language, pilot participants, and producer workflow;
- applying production changes after reviewing staging evidence.

Codex should give Andrew one operational task at a time and continue all
independent repository work in parallel.

## Andrew task queue

Tasks are intentionally ordered; only the first incomplete task is active.

1. ~~**Start Docker Desktop on the development Mac.**~~ Complete.
2. ~~**Confirm staging capacity and placement.**~~ Complete. The shared Coolify
   host has 8 CPU cores, 22 GiB RAM (16 GiB available at measurement time), and
   155 GB free disk. A staging stack can share this host.
3. ~~**Create an isolated staging Supabase stack.**~~ Complete. The isolated
   service is deployed at `https://supabase-staging.theplatelab.site`; HTTPS,
   Kong/Auth, the application schema, least-privilege grants, and the RLS
   access matrix all pass.
4. Configure production SMTP and test confirmation, invitation, and recovery
   delivery. Staging SMTP and confirmation-email delivery now pass.
5. Configure daily off-host Postgres and MinIO backups and perform one restore.
6. Add the approved public and server-only Supabase variables to the staging
   Next.js resource in Coolify.
7. Review the first staging vertical slice and nominate pilot accounts.

## Current status

- Production Supabase HTTPS/TLS: passed.
- Kong/Auth/anon-key request: passed.
- `vector`, `pgcrypto`, and `pg_trgm`: installed.
- Realtime Broadcast WebSocket and heartbeat: passed.
- Supabase application packages: pinned.
- Browser, SSR, privileged server clients, and session middleware: added
  locally.
- Login, recovery, confirmation/callback routes, and protected project shell:
  added locally.
- Local Supabase stack: running.
- Initial identity/project migration: applies cleanly from an empty database.
- Foundation, grants, RLS access-matrix, and schema-lint checks: passed.
- Generated database types: wired into all Supabase clients.
- Shared Coolify host capacity for staging: passed.
- Staging DNS, trusted TLS, Traefik, Kong, and Auth routing: passed.
- Staging anon-key access and Auth configuration (email on, confirmation
  required, phone/SMS off): passed.
- Secure staging database administration path through Kong/pg-meta: passed.
- Staging application schema and RLS access matrix: passed.
- Staging Resend SMTP configuration and confirmation-email delivery: passed.
- Production SMTP, backups, and catalog migration: pending.
