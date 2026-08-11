type PublicSupabaseEnvironment = {
  url: string;
  publishableKey: string;
};

type AdminSupabaseEnvironment = PublicSupabaseEnvironment & {
  secretKey: string;
};

function required(value: string | undefined, names: string[]): string {
  const normalized = value?.trim();
  if (normalized) return normalized;

  throw new Error(
    `Missing Supabase environment variable. Set one of: ${names.join(", ")}.`,
  );
}

export function getPublicSupabaseEnvironment(): PublicSupabaseEnvironment {
  return {
    url: required(process.env.NEXT_PUBLIC_SUPABASE_URL, [
      "NEXT_PUBLIC_SUPABASE_URL",
    ]),
    publishableKey: required(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      [
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ],
    ),
  };
}

export function getAdminSupabaseEnvironment(): AdminSupabaseEnvironment {
  const publicEnvironment = getPublicSupabaseEnvironment();

  return {
    ...publicEnvironment,
    secretKey: required(
      process.env.SUPABASE_SECRET_KEY ??
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    ),
  };
}
