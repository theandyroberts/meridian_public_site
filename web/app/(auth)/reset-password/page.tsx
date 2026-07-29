import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "../actions";

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/forgot-password");

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="mono accent">Account recovery</p>
        <h1>Choose a new password</h1>
        <p className="auth-intro">
          Use at least 12 characters and avoid reusing a password from another
          service.
        </p>

        {params.error && <p className="auth-alert error">{params.error}</p>}

        <form action={updatePassword} className="auth-form">
          <label>
            <span className="mono">New password</span>
            <input
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            <span className="mono">Confirm password</span>
            <input
              name="passwordConfirmation"
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
          </label>
          <button type="submit" className="auth-submit">
            Update password
          </button>
        </form>
      </section>
    </main>
  );
}
