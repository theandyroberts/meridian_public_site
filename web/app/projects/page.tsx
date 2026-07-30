import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";

export const dynamic = "force-dynamic";

function projectDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/projects");

  const { data: projects, error } = await supabase
    .from("projects")
    .select(
      "id, name, production_name, client_name, status, last_activity_at",
    )
    .eq("status", "active")
    .order("last_activity_at", { ascending: false });

  const projectIds = projects?.map((project) => project.id) ?? [];
  const { data: scenes } = projectIds.length
    ? await supabase
        .from("scenes")
        .select("id, project_id")
        .in("project_id", projectIds)
        .is("archived_at", null)
    : { data: [] };

  const sceneCounts = new Map<string, number>();
  for (const scene of scenes ?? []) {
    sceneCounts.set(
      scene.project_id,
      (sceneCounts.get(scene.project_id) ?? 0) + 1,
    );
  }

  return (
    <main className="workspace-shell">
      <section className="workspace-intro">
        <div>
          <p className="mono accent">Client workspace</p>
          <h1>Projects</h1>
          <p className="dim">
            Build each production scene by scene, then find and review its
            plates.
          </p>
        </div>
        <div className="workspace-actions">
          <Link href="/projects/new" className="primary-button">
            Start a project
          </Link>
          <form action={signOut}>
            <button type="submit" className="secondary-button mono">
              Sign out
            </button>
          </form>
        </div>
      </section>

      {error && (
        <p className="auth-alert error">
          Your projects could not be loaded. Please refresh and try again.
        </p>
      )}

      {projects?.length ? (
        <section className="project-grid" aria-label="Your projects">
          {projects.map((project) => {
            const count = sceneCounts.get(project.id) ?? 0;
            return (
              <Link
                href={`/projects/${project.id}`}
                className="project-card"
                key={project.id}
              >
                <div>
                  <p className="mono accent">
                    {count} scene{count === 1 ? "" : "s"}
                  </p>
                  <h2>{project.name}</h2>
                  <p className="dim">
                    {[project.production_name, project.client_name]
                      .filter(Boolean)
                      .join(" · ") || "Production details not added yet"}
                  </p>
                </div>
                <p className="mono dimmer">
                  Updated {projectDate(project.last_activity_at)}
                </p>
              </Link>
            );
          })}
        </section>
      ) : (
        <section className="workspace-empty">
          <p className="mono accent">Start with the shot list</p>
          <h2>Turn the production into a searchable plate plan.</h2>
          <p>
            Create the project, add the first scene, and describe what needs to
            be outside the windows. We will carry that context into the plate
            catalog.
          </p>
          <Link href="/projects/new" className="primary-button inline-cta">
            Create your first project
          </Link>
        </section>
      )}
    </main>
  );
}
