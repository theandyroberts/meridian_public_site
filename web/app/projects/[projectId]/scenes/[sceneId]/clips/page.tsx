import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { plateSchema } from "@platelab/shared";
import {
  SceneClipWorkspace,
  type SceneClipWorkspaceCandidate,
} from "@/components/SceneClipWorkspace";
import { publicMediaUrl } from "@/lib/publicMediaUrl";
import { formatSceneClipSelectionDuration } from "@/lib/sceneClipSelection";
import { buildStudioHref, type StudioSceneContext } from "@/lib/studioHref";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SceneClipWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string; sceneId: string }>;
}) {
  const { projectId, sceneId } = await params;
  const path = `/projects/${projectId}/scenes/${sceneId}/clips`;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);

  const [
    { data: project },
    { data: scene },
    { data: rows, error: clipsError },
  ] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    supabase
      .from("scenes")
      .select("id, project_id, name")
      .eq("id", sceneId)
      .eq("project_id", projectId)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("scene_clips")
      .select(
        "id, status, version, in_frame, out_frame, stock_clips(source_metadata)",
      )
      .eq("scene_id", sceneId)
      .order("sort_order")
      .order("created_at"),
  ]);

  if (!project || !scene) notFound();

  const studioContext: StudioSceneContext = {
    projectId: project.id,
    projectName: project.name,
    sceneId: scene.id,
    sceneName: scene.name,
  };
  const candidates: SceneClipWorkspaceCandidate[] = (rows ?? []).flatMap((row) => {
    const relation = Array.isArray(row.stock_clips)
      ? row.stock_clips[0]
      : row.stock_clips;
    if (!relation) return [];
    const plate = plateSchema.parse(relation.source_metadata);
    const studioHref = plate.stageCompat.includes("led-volume") && plate.renditions.stagePreview
      ? buildStudioHref({
          video: publicMediaUrl(plate.renditions.stagePreview),
          label: `${plate.sku} · ${plate.title}`,
          fps: plate.media.fps,
          sourceTimecode: plate.media.timecode,
          sku: plate.sku,
          scene: studioContext,
          selection: {
            sceneClipId: row.id,
            version: row.version,
            inFrame: row.in_frame,
            outFrame: row.out_frame,
          },
        })
      : null;
    return [{
      id: row.id,
      status: row.status,
      version: row.version,
      plate,
      studioHref,
      selectedDuration: formatSceneClipSelectionDuration(
        row.in_frame,
        row.out_frame,
        plate.media.fps,
      ),
    }];
  });

  return (
    <main className="workspace-shell scene-workspace">
      <div className="scene-nav">
        <Link
          href={`/projects/${project.id}/scenes/${scene.id}`}
          className="mono dim back-link"
        >
          ← {scene.name}
        </Link>
        <Link href={`/projects/${project.id}`} className="secondary-button">
          Project overview
        </Link>
      </div>
      <section className="scene-heading">
        <div>
          <p className="mono accent">Scene clip workspace</p>
          <h1>Compare candidates for {scene.name}</h1>
          <p>
            Review saved candidates in one place. Rejection only changes this
            scene’s workflow status; it never deletes footage from the catalog.
          </p>
        </div>
      </section>
      {clipsError ? (
        <p className="auth-alert" role="alert">
          Scene candidates could not be loaded. Refresh the page or return to
          the scene and try again.
        </p>
      ) : (
        <SceneClipWorkspace initialCandidates={candidates} />
      )}
    </main>
  );
}
