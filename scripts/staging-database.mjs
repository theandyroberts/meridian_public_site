import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const action = process.argv[2] ?? "check";
const allowedActions = new Set(["check", "apply"]);

if (!allowedActions.has(action)) {
  throw new Error("Usage: node scripts/staging-database.mjs <check|apply>");
}

const supabaseUrl =
  process.env.TPL_STAGING_SUPABASE_URL ??
  "https://supabase-staging.theplatelab.site";
const serviceRoleKey = await environmentOrSecretPrompt(
  "TPL_STAGING_SERVICE_ROLE_KEY",
  "Paste staging service-role key: ",
);
const postgresPassword = await environmentOrSecretPrompt(
  "TPL_STAGING_POSTGRES_PASSWORD",
  "Paste staging PostgreSQL password: ",
);
const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const postgresUrl = `postgresql://postgres:${encodeURIComponent(
  postgresPassword,
)}@supabase-db:5432/postgres`;

async function query(sql) {
  const response = await fetch(`${supabaseUrl}/pg/query`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      pg: postgresUrl,
      "x-pg-application-name": "tpl-schema-deploy",
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Staging SQL request failed (${response.status}): ${body}`,
    );
  }

  return body ? JSON.parse(body) : [];
}

if (action === "check") {
  const rows = await query(`
    select
      current_database() as database_name,
      current_user as database_user,
      current_setting('server_version') as postgres_version,
      coalesce(
        array_agg(extname order by extname)
          filter (where extname in ('pg_trgm', 'pgcrypto', 'vector')),
        '{}'::name[]
      ) as required_extensions
    from pg_extension;
  `);

  console.log(JSON.stringify(rows, null, 2));
  console.log("Staging database connection passed.");
}

if (action === "apply") {
  const migrations = [
    {
      path: "supabase/migrations/20260729190000_identity_projects_foundation.sql",
      appliedSql:
        "select to_regclass('public.projects') is not null as applied;",
    },
    {
      path: "supabase/migrations/20260729230000_normalize_api_role_grants.sql",
      appliedSql: `
        select
          to_regclass('public.projects') is not null
          and not has_table_privilege('anon', 'public.projects', 'SELECT')
          and not has_table_privilege(
            'authenticated',
            'public.profiles',
            'DELETE'
          ) as applied;
      `,
    },
    {
      path: "supabase/migrations/20260730020000_project_onboarding.sql",
      appliedSql: `
        select
          to_regprocedure(
            'public.start_project(text,text,text,text,text,text,text)'
          ) is not null
          and to_regprocedure(
            'public.add_project_scene(uuid,text,text)'
          ) is not null as applied;
      `,
    },
  ];

  for (const migration of migrations) {
    const status = await query(migration.appliedSql);

    if (status[0]?.applied) {
      console.log(`Already applied ${migration.path}`);
      continue;
    }

    const sql = await readFile(
      `${projectDirectory}/${migration.path}`,
      "utf8",
    );
    await query(sql);
    console.log(`Applied ${migration.path}`);
  }

  const tests = [
    "supabase/tests/0001_foundation_checks.sql",
    "supabase/tests/0002_rls_access_matrix.sql",
    "supabase/tests/0003_project_onboarding_checks.sql",
  ];

  for (const relativePath of tests) {
    const sql = await readFile(`${projectDirectory}/${relativePath}`, "utf8");
    await query(sql);
    console.log(`Passed ${relativePath}`);
  }

  console.log("Staging foundation migration and access checks passed.");
}

async function environmentOrSecretPrompt(name, prompt) {
  const value = process.env[name]?.trim();

  if (value) {
    return value;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${name} is required`);
  }

  return promptForSecret(prompt);
}

function promptForSecret(prompt) {
  return new Promise((resolve, reject) => {
    let secret = "";
    const input = process.stdin;

    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();

    const finish = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };

    const onData = (characters) => {
      for (const character of characters) {
        if (character === "\r" || character === "\n") {
          finish();
          resolve(secret.trim());
          return;
        }

        if (character === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }

        if (character === "\u007f") {
          secret = secret.slice(0, -1);
          continue;
        }

        secret += character;
      }
    };

    input.on("data", onData);
  });
}
