"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function formString(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function formError(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}error=${encodeURIComponent(message)}`);
}

export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/projects/new");

  const organizationName = formString(formData, "organizationName");
  const projectName = formString(formData, "projectName");
  const firstSceneName = formString(formData, "firstSceneName");
  const searchBrief = formString(formData, "searchBrief");

  if (!projectName || !firstSceneName) {
    formError(
      "/projects/new",
      "Give the project and its first scene a name.",
    );
  }

  const { data, error } = await supabase.rpc("start_project", {
    organization_name: organizationName,
    project_name: projectName,
    first_scene_name: firstSceneName,
    search_brief: searchBrief || undefined,
    display_name: formString(formData, "displayName") || undefined,
    production_name: formString(formData, "productionName") || undefined,
    client_name: formString(formData, "clientName") || undefined,
  });

  const result = data?.[0];
  if (error || !result) {
    formError(
      "/projects/new",
      "The project could not be created. Check the details and try again.",
    );
  }

  redirect(
    `/projects/${result.project_id}/scenes/${result.scene_id}?created=1`,
  );
}

export async function createScene(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projectId = formString(formData, "projectId");

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/projects/${projectId}`)}`,
    );
  }

  const sceneName = formString(formData, "sceneName");
  if (!projectId || !sceneName) {
    formError(`/projects/${projectId}`, "Give the scene a name.");
  }

  const { data: sceneId, error } = await supabase.rpc(
    "add_project_scene",
    {
      target_project_id: projectId,
      scene_name: sceneName,
      search_brief: formString(formData, "searchBrief") || undefined,
    },
  );

  if (error || !sceneId) {
    formError(
      `/projects/${projectId}`,
      "The scene could not be added. Please try again.",
    );
  }

  redirect(`/projects/${projectId}/scenes/${sceneId}?created=1`);
}

export async function addClipToScene(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projectId = formString(formData, "projectId");
  const sceneId = formString(formData, "sceneId");
  const stockClipId = formString(formData, "stockClipId");

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(
        `/projects/${projectId}/scenes/${sceneId}`,
      )}`,
    );
  }
  if (!sceneId || !stockClipId) {
    formError(
      `/projects/${projectId}/scenes/${sceneId}`,
      "Choose a valid catalog clip.",
    );
  }

  const { error } = await supabase.rpc("add_clip_to_scene", {
    target_scene_id: sceneId,
    target_stock_clip_id: stockClipId,
  });
  if (error) {
    formError(
      `/projects/${projectId}/scenes/${sceneId}`,
      "The clip could not be added to this scene.",
    );
  }
  revalidatePath(`/projects/${projectId}/scenes/${sceneId}`);
}

export async function updateSceneClipStatus(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projectId = formString(formData, "projectId");
  const sceneId = formString(formData, "sceneId");
  const sceneClipId = formString(formData, "sceneClipId");
  const status = formString(formData, "status");
  const expectedVersion = Number(formString(formData, "expectedVersion"));
  const statuses = new Set([
    "considering",
    "shortlisted",
    "selected",
    "rejected",
    "submitted",
  ]);

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(
        `/projects/${projectId}/scenes/${sceneId}`,
      )}`,
    );
  }
  if (
    !sceneClipId ||
    !statuses.has(status) ||
    !Number.isInteger(expectedVersion)
  ) {
    formError(
      `/projects/${projectId}/scenes/${sceneId}`,
      "Refresh the scene and try that status change again.",
    );
  }

  const { error } = await supabase.rpc("set_scene_clip_status", {
    target_scene_clip_id: sceneClipId,
    next_status: status as
      | "considering"
      | "shortlisted"
      | "selected"
      | "rejected"
      | "submitted",
    expected_version: expectedVersion,
  });
  if (error) {
    formError(
      `/projects/${projectId}/scenes/${sceneId}`,
      "The clip changed in another session. Refresh and retry.",
    );
  }
  revalidatePath(`/projects/${projectId}/scenes/${sceneId}`);
}
