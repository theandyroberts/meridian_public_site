import Link from "next/link";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { signIn, signInWithGoogle, signUp } from "../actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
    mode?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const isSignup = params.mode === "signup";
  const googleEnabled =
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect(next);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="mono accent">Build your plate plan</p>
        <h1>{isSignup ? "Start your first project" : "Welcome back"}</h1>
        <p className="auth-intro">
          {isSignup
            ? "Create a project, break down the scenes you need to shoot, then find the right environments for each one."
            : "Open your projects, scenes, selected clips, and THE LAB review setup."}
        </p>

        {params.error && <p className="auth-alert error">{params.error}</p>}
        {params.message && (
          <p className="auth-alert success">{params.message}</p>
        )}

        {googleEnabled && (
          <>
            <form action={signInWithGoogle} className="oauth-form">
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="oauth-button">
                <span aria-hidden="true" className="google-mark">G</span>
                Continue with Google
              </button>
            </form>

            <div className="auth-divider">
              <span>or continue with email</span>
            </div>
          </>
        )}

        <form action={isSignup ? signUp : signIn} className="auth-form">
          <input type="hidden" name="next" value={next} />
          {isSignup && (
            <label>
              <span className="mono">Your name</span>
              <input
                name="displayName"
                type="text"
                autoComplete="name"
                maxLength={120}
                required
              />
            </label>
          )}
          <label>
            <span className="mono">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label>
            <span className="mono">Password</span>
            <input
              name="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={isSignup ? 12 : undefined}
              required
            />
          </label>
          {isSignup && (
            <label>
              <span className="mono">Confirm password</span>
              <input
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            </label>
          )}
          <button type="submit" className="auth-submit">
            {isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="auth-links">
          {isSignup ? (
            <Link href={`/login?next=${encodeURIComponent(next)}`}>
              Already have an account?
            </Link>
          ) : (
            <>
              <Link href="/forgot-password">Forgot password?</Link>
              <Link
                href={`/login?mode=signup&next=${encodeURIComponent(next)}`}
              >
                Create an account
              </Link>
            </>
          )}
          <Link href="/">Return to the catalog</Link>
        </div>
      </section>
    </main>
  );
}
