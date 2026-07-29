import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/projects");

  return (
    <main className="workspace-shell">
      <section className="workspace-intro">
        <div>
          <p className="mono accent">Client workspace</p>
          <h1>Projects</h1>
          <p className="dim">
            Signed in as {user.email}. Project and scene records arrive in the
            next database migration.
          </p>
        </div>
        <form action={signOut}>
          <button type="submit" className="secondary-button mono">
            Sign out
          </button>
        </form>
      </section>

      <section className="workspace-empty">
        <p className="mono">Foundation connected</p>
        <h2>Your project workspace is ready for its data model.</h2>
        <p>
          This protected shell verifies the SSR cookie session before any
          customer project data is exposed.
        </p>
      </section>
    </main>
  );
}
