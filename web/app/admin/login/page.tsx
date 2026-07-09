import { login } from "./actions";

export const metadata = { title: "Admin — The Plate Lab" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1 style={{ marginBottom: 24 }}>Admin</h1>
      {error && <p className="mono" style={{ color: "var(--orange)", marginBottom: 16 }}>Wrong password</p>}
      <form action={login}>
        <input className="search-input" type="password" name="password"
          placeholder="ADMIN PASSWORD" aria-label="Admin password" autoFocus />
        <button className="cta mono" type="submit" style={{ marginTop: 16 }}>Sign in →</button>
      </form>
    </main>
  );
}
