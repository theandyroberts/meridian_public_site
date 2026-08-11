const FALLBACK_PATH = "/projects";

export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback = FALLBACK_PATH,
): string {
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://theplatelab.invalid");
    if (parsed.origin !== "https://theplatelab.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
