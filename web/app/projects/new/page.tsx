import Link from "next/link";
import { redirect } from "next/navigation";
import { SceneImportPanel } from "@/components/SceneImportPanel";
import { createClient } from "@/lib/supabase/server";
import { createProject } from "../actions";

type NewProjectPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: NewProjectPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/projects/new");

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("organization_memberships")
      .select("organization_id, organizations(name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);

  const organization = membership?.organizations;

  return (
    <main className="workspace-shell narrow-workspace new-project-workspace">
      <header className="lab-task-header">
        <div>
          <Link href="/projects" className="mono dim back-link">
            ← Projects
          </Link>
          <h1>New project</h1>
        </div>
        <div className="lab-task-meta mono">
          {organization?.name && <span>{organization.name}</span>}
          <span className="accent">Step 1 of 3</span>
        </div>
      </header>

      {params.error && <p className="auth-alert error">{params.error}</p>}

      <form action={createProject} className="workspace-form dense-form">
        <input type="hidden" name="vehicle" value="sedan" />
        {organization ? (
          <input
            name="organizationName"
            type="hidden"
            value={organization.name}
          />
        ) : null}

        <div className="project-basics-grid">
          <label className="primary-project-field">
            <span>Working title or code name</span>
            <input
              name="workingTitle"
              type="text"
              placeholder="BLACKLIST_MOVIE"
              maxLength={200}
              required
              autoFocus
            />
          </label>
          <label>
            <span>Client <em>optional</em></span>
            <input
              name="clientName"
              type="text"
              placeholder="Brand or agency"
              maxLength={200}
            />
          </label>
          {!organization && (
            <label>
              <span>Production company</span>
              <input
                name="organizationName"
                type="text"
                autoComplete="organization"
                maxLength={160}
                required
              />
            </label>
          )}
          {!profile?.display_name && (
            <label>
              <span>Your name</span>
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
            <span>Actual title <em>optional · private</em></span>
            <input
              name="actualTitle"
              type="text"
              placeholder="Only if useful internally"
              maxLength={200}
              autoComplete="off"
            />
          </label>
        </div>

        <SceneImportPanel variant="new-project" />

        <details className="form-section manual-scene-section">
          <summary>Or enter the first scene manually</summary>
          <div className="manual-scene-body">
            <div className="manual-scene-grid">
              <label>
                <span>Scene title</span>
                <input
                  name="firstSceneName"
                  type="text"
                  placeholder="Marta’s escape from the estate"
                  maxLength={200}
                />
              </label>
              <label>
                <span>Script scene number <em>optional</em></span>
                <input
                  name="scriptSceneNumber"
                  type="text"
                  placeholder="41 or 41A"
                  maxLength={40}
                />
              </label>
              <label>
                <span>Script page(s) <em>optional</em></span>
                <input
                  name="scriptPages"
                  type="text"
                  placeholder="74–75"
                  maxLength={80}
                />
              </label>
              <label className="manual-scene-brief">
                <span>Scene description / plate brief</span>
                <textarea
                  name="searchBrief"
                  placeholder="Wet urban highway at night, sparse traffic, clean forward travel…"
                  rows={3}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="submit"
                name="intent"
                value="add-more"
                className="primary-button"
              >
                + Create and add another
              </button>
              <button
                type="submit"
                name="intent"
                value="find-plates"
                className="secondary-button"
              >
                Create and find plates
              </button>
            </div>
          </div>
        </details>
      </form>
    </main>
  );
}
