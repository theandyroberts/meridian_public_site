import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createScene } from "../actions";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    added?: string;
    created?: string;
    deleted?: string;
    error?: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
  }

  const [{ data: project }, { data: scenes }] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, production_name, client_name, production_approach",
      )
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("scenes")
      .select(
        "id, scene_number, name, search_brief, vehicle, script_scene_number, script_pages",
      )
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("sort_order")
      .order("scene_number"),
  ]);

  if (!project) notFound();

  return (
    <main className="workspace-shell">
      <Link href="/projects" className="mono dim back-link">
        ← Projects
      </Link>

      <section className="workspace-intro project-heading">
        <div>
          <p className="mono accent">Project</p>
          <h1>{project.name}</h1>
          <p className="dim">
            {[project.production_name, project.client_name]
              .filter(Boolean)
              .join(" · ") || "Add scenes, then choose the plates for each shot."}
          </p>
        </div>
        <span className="status-chip mono">
          {project.production_approach === "undecided"
            ? "Stage undecided"
            : project.production_approach.replaceAll("_", " ")}
        </span>
      </section>

      {query.error && <p className="auth-alert error">{query.error}</p>}
      {query.created === "1" && (
        <p className="auth-alert success">
          Project created. Keep adding scenes below, or open any saved scene
          when you are ready to choose clips.
        </p>
      )}
      {query.added === "1" && (
        <p className="auth-alert success">
          Scene saved. Add the next scene while the shot list is in front of
          you.
        </p>
      )}
      {query.deleted === "1" && (
        <p className="auth-alert success">
          Scene deleted from this project.
        </p>
      )}

      <section className="project-detail-grid">
        <div>
          <div className="section-head compact">
            <div>
              <p className="mono accent">Step 2 of 3</p>
              <h2>Scenes</h2>
            </div>
            <div className="scene-list-actions">
              <span className="mono dim">
                {scenes?.length ?? 0} total
              </span>
              <a href="#add-scene" className="secondary-button">
                + Add scene
              </a>
            </div>
          </div>

          <div className="scene-list">
            {scenes?.map((scene) => (
              <Link
                href={`/projects/${project.id}/scenes/${scene.id}`}
                className="scene-row"
                key={scene.id}
              >
                <span className="scene-number mono">
                  {scene.script_scene_number
                    ? `Sc ${scene.script_scene_number}`
                    : String(scene.scene_number).padStart(2, "0")}
                </span>
                <span>
                  <strong>{scene.name}</strong>
                  {scene.script_pages && (
                    <span className="scene-script-pages mono">
                      Script p. {scene.script_pages}
                    </span>
                  )}
                  <small>
                    {scene.search_brief || "Add a search brief"}
                  </small>
                </span>
                <span className="scene-arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>

        <aside className="add-scene-card" id="add-scene">
          <p className="mono accent">Add another scene</p>
          <h2>What else is on the shot list?</h2>
          <form action={createScene} className="workspace-form compact-form">
            <input type="hidden" name="projectId" value={project.id} />
            <label>
              <span>Scene title</span>
              <input
                name="sceneName"
                type="text"
                placeholder="Ransom’s getaway"
                maxLength={200}
                required
              />
            </label>
            <div className="form-grid compact-metadata-grid">
              <label>
                <span>Script scene <em>optional</em></span>
                <input
                  name="scriptSceneNumber"
                  type="text"
                  placeholder="41"
                  maxLength={40}
                />
              </label>
              <label>
                <span>Page(s) <em>optional</em></span>
                <input
                  name="scriptPages"
                  type="text"
                  placeholder="74–75"
                  maxLength={80}
                />
              </label>
            </div>
            <label>
              <span>Scene description / plate brief</span>
              <textarea
                name="searchBrief"
                placeholder="Open coast, clear horizon, late afternoon…"
                rows={6}
              />
            </label>
            <div className="stacked-form-actions">
              <button
                type="submit"
                name="intent"
                value="add-another"
                className="primary-button"
              >
                + Save and add another
              </button>
              <button
                type="submit"
                name="intent"
                value="find-plates"
                className="secondary-button"
              >
                Save and find plates
              </button>
            </div>
          </form>
        </aside>
      </section>
    </main>
  );
}
