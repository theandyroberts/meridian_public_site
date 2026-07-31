import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SceneImportPanel } from "@/components/SceneImportPanel";
import { createClient } from "@/lib/supabase/server";
import {
  createScene,
  importScenes,
  updateProject,
} from "../actions";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    added?: string;
    created?: string;
    deleted?: string;
    error?: string;
    imported?: string;
    updated?: string;
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
        "id, name, actual_title, client_name, description, due_date, production_approach",
      )
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("scenes")
      .select(
        "id, scene_number, name, search_brief, vehicle, script_scene_number, script_pages, generated_keywords, keyword_generation_status",
      )
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("sort_order")
      .order("scene_number"),
  ]);

  if (!project) notFound();

  return (
    <main className="workspace-shell project-workspace">
      <Link href="/projects" className="mono dim back-link">
        ← Projects
      </Link>

      <header className="workspace-intro project-heading">
        <div>
          <h1>{project.name}</h1>
          <p className="dim">
            {project.client_name || "No client specified"}
          </p>
        </div>
        <div className="project-heading-tools">
          <span className="status-chip mono">
            {project.production_approach === "undecided"
              ? "Stage undecided"
              : project.production_approach.replaceAll("_", " ")}
          </span>
          <details className="project-details-editor">
            <summary className="secondary-button">Edit project</summary>
            <div className="project-details-panel">
              <div>
                <p className="mono accent">Project details</p>
                <h2>Edit project</h2>
              </div>
              <form
                action={updateProject}
                className="workspace-form compact-form"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <div className="form-grid">
                  <label>
                    <span>Working title or code name</span>
                    <input
                      name="workingTitle"
                      type="text"
                      defaultValue={project.name}
                      maxLength={200}
                      required
                    />
                  </label>
                  <label>
                    <span>
                      Actual production title <em>optional · private</em>
                    </span>
                    <input
                      name="actualTitle"
                      type="text"
                      defaultValue={project.actual_title ?? ""}
                      placeholder="Leave blank unless it is useful"
                      maxLength={200}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>Client <em>optional</em></span>
                    <input
                      name="clientName"
                      type="text"
                      defaultValue={project.client_name ?? ""}
                      maxLength={200}
                    />
                  </label>
                  <label>
                    <span>Needed by <em>optional</em></span>
                    <input
                      name="dueDate"
                      type="date"
                      defaultValue={project.due_date ?? ""}
                    />
                  </label>
                </div>
                <label>
                  <span>Internal project notes <em>optional</em></span>
                  <textarea
                    name="projectDescription"
                    defaultValue={project.description ?? ""}
                    rows={3}
                    placeholder="Production context, stage constraints, delivery notes…"
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary-button">
                    Save project details
                  </button>
                </div>
              </form>
            </div>
          </details>
        </div>
      </header>

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
      {query.imported && (
        <p className="auth-alert success">
          Imported {query.imported} approved scene
          {query.imported === "1" ? "" : "s"} from JSON.
        </p>
      )}
      {query.updated === "1" && (
        <p className="auth-alert success">Project details updated.</p>
      )}

      <section className="project-detail-grid">
        <div>
          <div className="section-head compact">
            <div>
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

          <div className="scene-table-wrap">
            <table className="scene-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Script</th>
                  <th scope="col">Page(s)</th>
                  <th scope="col">Scene</th>
                  <th scope="col">Plate brief</th>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Search</th>
                  <th scope="col" aria-label="Open scene" />
                </tr>
              </thead>
              <tbody>
                {scenes?.map((scene) => {
                  const href = `/projects/${project.id}/scenes/${scene.id}`;
                  const keywordCount = scene.generated_keywords?.length ?? 0;
                  return (
                    <tr key={scene.id}>
                      <td className="scene-sequence mono">
                        {String(scene.scene_number).padStart(2, "0")}
                      </td>
                      <td className="scene-script mono-md">
                        {scene.script_scene_number || "—"}
                      </td>
                      <td className="scene-pages mono-md">
                        {scene.script_pages || "—"}
                      </td>
                      <td className="scene-name-cell">
                        <Link href={href}>{scene.name}</Link>
                      </td>
                      <td className="scene-brief">
                        <Link href={href}>
                          {scene.search_brief || "Add a plate brief"}
                        </Link>
                      </td>
                      <td className="scene-vehicle mono">
                        {scene.vehicle === "undecided"
                          ? "—"
                          : scene.vehicle.replaceAll("_", " ")}
                      </td>
                      <td>
                        <span
                          className={`scene-search-state mono ${
                            keywordCount ? "is-ready" : ""
                          }`}
                        >
                          {keywordCount
                            ? `${keywordCount} terms`
                            : scene.keyword_generation_status === "pending"
                              ? "Pending"
                              : "—"}
                        </span>
                      </td>
                      <td className="scene-open-cell">
                        <Link href={href} aria-label={`Open ${scene.name}`}>
                          →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="add-scene-card" id="add-scene">
          <h2>Add scene</h2>
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
                rows={4}
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

      <SceneImportPanel
        variant="existing-project"
        projectId={project.id}
        action={importScenes}
      />
    </main>
  );
}
