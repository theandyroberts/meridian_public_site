type UserIdentity = {
  email?: string | null;
  userMetadata?: Record<string, unknown> | null;
};

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function accountDisplayName(
  profileName: string | null | undefined,
  identity: UserIdentity,
): string {
  const metadata = identity.userMetadata ?? {};
  const candidates = [
    profileName,
    metadata.display_name,
    metadata.full_name,
    metadata.name,
    identity.email,
  ];

  for (const candidate of candidates) {
    const value = nonEmptyString(candidate);
    if (value) return value;
  }

  return "Account";
}
