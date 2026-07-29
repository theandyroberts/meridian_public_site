import Link from "next/link";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { signIn } from "../actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect(next);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="mono accent">Client workspace</p>
        <h1>Sign in to The Plate Lab</h1>
        <p className="auth-intro">
          Open your projects, scenes, selected clips, and THE LAB review setup.
        </p>

        {params.error && <p className="auth-alert error">{params.error}</p>}
        {params.message && (
          <p className="auth-alert success">{params.message}</p>
        )}

        <form action={signIn} className="auth-form">
          <input type="hidden" name="next" value={next} />
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
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" className="auth-submit">
            Sign in
          </button>
        </form>

        <div className="auth-links">
          <Link href="/forgot-password">Forgot password?</Link>
          <Link href="/">Return to the catalog</Link>
        </div>
      </section>
    </main>
  );
}
