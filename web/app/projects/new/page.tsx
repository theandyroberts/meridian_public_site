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
    <main className="workspace-shell narrow-workspace">
      <Link href="/projects" className="mono dim back-link">
        ← Projects
      </Link>

      <section className="onboarding-heading">
        <p className="mono accent">Step 1 of 3 · Project</p>
        <h1>What are you shooting?</h1>
        <p>
          Give the production a home and start the shot list. After saving,
          the + flow keeps you in scene entry until the whole script is
          covered.
        </p>
      </section>

      {params.error && <p className="auth-alert error">{params.error}</p>}

      <form action={createProject} className="workspace-form">
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
          <span>Production company</span>
          <input
            name="organizationName"
            type="text"
            autoComplete="organization"
            defaultValue={organization?.name ?? ""}
            readOnly={Boolean(organization)}
            maxLength={160}
            required
          />
          {organization && (
            <small>
              This project will be available to your {organization.name} team.
            </small>
          )}
        </label>

        <div className="form-grid">
          <label>
            <span>Project name</span>
            <input
              name="projectName"
              type="text"
              placeholder="Untitled automotive spot"
              maxLength={200}
              required
              autoFocus
            />
          </label>
          <label>
            <span>Production name <em>optional</em></span>
            <input
              name="productionName"
              type="text"
              placeholder="Working title"
              maxLength={200}
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
        </div>

        <SceneImportPanel variant="new-project" />

        <div className="form-section">
          <p className="mono accent">Or enter the first scene manually</p>
          <div className="form-grid">
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
          </div>
          <label>
            <span>Scene description / plate brief</span>
            <textarea
              name="searchBrief"
              placeholder="Wet urban highway at night, sparse traffic, clean forward travel…"
              rows={5}
            />
            <small>
              Plain language is perfect. Location, weather, road, time of day,
              traffic, and camera direction all help.
            </small>
          </label>
        </div>

        <div className="form-actions">
          <button
            type="submit"
            name="intent"
            value="add-more"
            className="primary-button"
          >
            + Create project and add more scenes
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
      </form>
    </main>
  );
}
