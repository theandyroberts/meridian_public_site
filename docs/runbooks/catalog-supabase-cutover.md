# Catalog Supabase Cutover

This runbook moves the operational catalog from `web/data/catalog.json` to
Supabase Postgres. The JSON file remains a validated migration snapshot and
rollback artifact; the deployed web and Supabase-enabled ingest pipeline use
Postgres.

## What ships

- Normalized stock clips, public assets, descriptors, full-clip segments, and
  scene clip selections.
- Row-level security for live public clips and project-owned selections.
- Postgres full-text search over clip metadata, arbitrary descriptors, and
  segments.
- pgvector embeddings with an HNSW cosine index.
- Reciprocal-rank fusion of keyword and semantic results.
- An idempotent JSON importer with exact metadata reconciliation.
- Retryable OpenAI embedding jobs for clips and segments.
- Supabase-backed homepage, browse, detail, project-scene search, ingest, and
  admin catalog actions.

## Staging order

Run these from the repository root on the staging branch:

```sh
npm run db:staging:apply
npm run catalog:staging:import
npm run catalog:staging:check
```

Each staging command prompts for secrets when they are not already present in
the process environment. Never paste those secrets into source files, Git, or
chat.

The expected import result is:

```text
Reconciled 8 rows; 16 embedding jobs await processing.
Imported and reconciled 8 catalog clips in staging.
```

## Coolify web environment

Set these on `platelab-web`, then restart the application:

```text
NEXT_PUBLIC_SUPABASE_URL=https://supabase-staging.theplatelab.site
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon key>
OPENAI_API_KEY=<OpenAI project key>
```

The existing legacy `/admin` catalog actions also require one server-only
Supabase credential:

```text
SUPABASE_SERVICE_ROLE_KEY=<staging service-role key>
```

Do not use a `NEXT_PUBLIC_` prefix for either secret. If the legacy admin
catalog is not needed during the first staging smoke test, omit the service
role key; public catalog and customer project features do not require it.

## Coolify ingest environment

Set these on `platelab-ingestd`, then restart it:

```text
CATALOG_BACKEND=supabase
SUPABASE_URL=https://supabase-staging.theplatelab.site
SUPABASE_SERVICE_ROLE_KEY=<staging service-role key>
```

The ingest service queues embedding jobs but does not call OpenAI directly, so
it does not need `OPENAI_API_KEY`.

## Process embeddings

Once the OpenAI Platform project has API quota, run:

```sh
npm run catalog:staging:embed
npm run catalog:staging:check
```

The first import creates 16 jobs: one clip embedding and one full-preview
segment embedding for each of the eight current plates. Failed jobs remain
retryable. The worker uses `text-embedding-3-large` with 1,536 output
dimensions so both catalog ingestion and query embeddings match the pgvector
column.

For ongoing operation, run `catalog:staging:embed` as a Coolify scheduled task
or a dedicated worker command after metadata ingestion. The command safely
exits after the current batch; `TPL_EMBED_BATCH_SIZE` defaults to 32 and may be
set from 1 through 128.

## Smoke checks

Verify:

1. `/`, `/browse`, and a known `/plate/PL-…` page render catalog records.
2. `/api/catalog/search?q=coastal` returns matching plates.
3. Browse facets still constrain results.
4. An email or Google user can create a project and first scene.
5. The scene brief returns catalog suggestions.
6. “Add to scene” persists after refresh.
7. Clip status changes persist and increment the record version.
8. A newly ingested draft appears in Supabase and the admin draft view.
9. Publishing the draft makes it visible publicly.

## Rollback

- Leave the original `web/data/catalog.json` unchanged.
- Remove or unset `CATALOG_BACKEND=supabase` to return the ingest daemon to its
  JSON compatibility writer.
- Roll the web deployment back to the commit before the Supabase catalog
  cutover.
- Do not delete the imported Postgres rows during rollback; retain them for
  comparison and retry.
