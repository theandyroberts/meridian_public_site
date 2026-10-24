# Supabase database changes

This directory is the source of truth for The Plate Lab database schema.

## Rules

- Develop and test migrations against a disposable local or staging database.
- Never make a production-only schema change in Studio.
- Never commit database passwords, service-role keys, secret keys, or signed
  Storage URLs.
- Apply production migrations only after staging SQL/RLS tests and a fresh
  backup.
- Prefer forward-fix migrations once a migration has reached production.

## Planned workflow

1. Set `TPL_STAGING_DATABASE_URL` in a local shell or secret manager.
2. Apply migrations to staging with the Supabase CLI or `psql`.
3. Run SQL/RLS tests from `supabase/tests`.
4. Generate TypeScript types into `shared/src/database.types.ts`.
5. Reconcile and exercise the application in staging.
6. Back up production and apply the reviewed migration set.

The exact remote commands will be added once the staging connection method is
confirmed. Do not place a database URL in this repository.
