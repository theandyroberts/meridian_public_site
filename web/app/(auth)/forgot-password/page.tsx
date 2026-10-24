import Link from "next/link";
import { requestPasswordReset } from "../actions";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="mono accent">Account recovery</p>
        <h1>Reset your password</h1>
        <p className="auth-intro">
          Enter the email address attached to your Plate Lab account.
        </p>

        {params.error && <p className="auth-alert error">{params.error}</p>}
        {params.message && (
          <p className="auth-alert success">{params.message}</p>
        )}

        <form action={requestPasswordReset} className="auth-form">
          <label>
            <span className="mono">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <button type="submit" className="auth-submit">
            Send recovery link
          </button>
        </form>

        <div className="auth-links">
          <Link href="/login">Return to sign in</Link>
        </div>
      </section>
    </main>
  );
}
