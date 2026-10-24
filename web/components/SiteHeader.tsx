import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { accountDisplayName } from "@/lib/auth/displayName";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "./Logo";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profileName: string | null = null;
  let projectCount: number | null = null;

  if (user) {
    const [{ data: profile }, { count }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
    ]);

    profileName = profile?.display_name ?? null;
    projectCount = count;
  }

  const displayName = user
    ? accountDisplayName(profileName, {
        email: user.email,
        userMetadata: user.user_metadata,
      })
    : null;

  return (
    <header className="site-header">
      <div className="wrap">
        <Logo />
        <nav className="site-nav" aria-label="Primary navigation">
          <Link className="site-nav-secondary" href="/browse">
            Search plates
          </Link>
          <Link className="site-nav-secondary" href="/browse?stage=led-volume">
            LED volume
          </Link>
          <Link className="projects-link" href="/projects">
            Projects{projectCount !== null ? ` (${projectCount})` : ""}
          </Link>
          {user && displayName ? (
            <div className="site-account" aria-label={`Signed in as ${displayName}`}>
              <span className="site-account-name mono">
                <span className="site-account-state">Signed in</span>
                <span className="site-account-identity" title={displayName}>
                  {displayName}
                </span>
              </span>
              <form action={signOut}>
                <button type="submit" className="site-account-logout mono">
                  Log out
                </button>
              </form>
            </div>
          ) : (
            <div className="site-auth-actions" aria-label="Account access">
              <Link
                className="site-login mono"
                href="/login?next=%2Fprojects"
              >
                Log in
              </Link>
              <Link className="cta mono" href="/projects/new">
                Start a project
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
