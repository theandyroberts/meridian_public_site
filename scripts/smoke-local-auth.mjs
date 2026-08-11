import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    cwd: projectDirectory,
    encoding: "utf8",
  }),
);
const email = `codex-auth-smoke-${Date.now()}@example.test`;

const response = await fetch(`${status.API_URL}/auth/v1/signup`, {
  method: "POST",
  headers: {
    apikey: status.PUBLISHABLE_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    password: "Local-Smoke-Test-Only-2026!",
  }),
});
const body = await response.json();
const user = body.user ?? body;

if (!response.ok || !user?.id) {
  throw new Error(
    `Auth signup failed (${response.status}): ${JSON.stringify(body)}`,
  );
}

const userId = user.id;
if (!/^[0-9a-f-]{36}$/i.test(userId)) {
  throw new Error("Auth returned an invalid user ID");
}

try {
  const profileCount = execFileSync(
    "psql",
    [
      status.DB_URL,
      "-Atc",
      `select count(*) from public.profiles where id = '${userId}'::uuid;`,
    ],
    { encoding: "utf8" },
  ).trim();

  if (profileCount !== "1") {
    throw new Error(`Expected one bootstrapped profile, found ${profileCount}`);
  }
} finally {
  execFileSync(
    "psql",
    [
      status.DB_URL,
      "-Atc",
      `delete from auth.users where id = '${userId}'::uuid;`,
    ],
    { stdio: "ignore" },
  );
}

console.log("Auth signup endpoint and profile bootstrap passed; fixture removed.");
