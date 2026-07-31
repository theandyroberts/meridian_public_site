"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  SceneImportError,
  type SceneImportDocument,
  parseSceneImportJson,
} from "@/lib/sceneImport";
import { extractSceneKeywords } from "@/lib/sceneKeywords";
import { createClient } from "@/lib/supabase/server";

function formString(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function formError(path: string, message: string): never {
  const [basePath, fragment] = path.split("#", 2);
  const separator = basePath.includes("?") ? "&" : "?";
  redirect(
    `${basePath}${separator}error=${encodeURIComponent(message)}${
      fragment ? `#${fragment}` : ""
    }`,
  );
}

function scenePath(projectId: string, sceneId: string): string {
  return `/projects/${projectId}/scenes/${sceneId}`;
}

function sceneImportFromForm(
  formData: FormData,
  errorPath: string,
): SceneImportDocument | null {
  const source = formString(formData, "sceneImportJson");
  if (!source) return null;

  try {
    return parseSceneImportJson(source);
  } catch (error) {
    formError(
      errorPath,
      error instanceof SceneImportError
        ? error.message
        : "The scene JSON could not be validated.",
    );
  }
}

async function analyzeSceneKeywords(description: string): Promise<{
  keywords: string[];
  status: "not_needed" | "pending" | "ready";
}> {
  if (!description.trim()) {
    return { keywords: [], status: "not_needed" };
  }

  try {
    return {
      keywords: await extractSceneKeywords(description),
      status: "ready",
    };
  } catch (error) {
    console.warn(
      `Scene saved with AI keyword analysis pending: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return { keywords: [], status: "pending" };
  }
}

export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/projects/new");

  const organizationName = formString(formData, "organizationName");
  const projectName = formString(formData, "projectName");
  const sceneImport = sceneImportFromForm(formData, "/projects/new");
  const importedFirstScene = sceneImport?.scenes[0];
  const firstSceneName =
    importedFirstScene?.scene_name ??
    formString(formData, "firstSceneName");
  const searchBrief =
    importedFirstScene?.description ??
    formString(formData, "searchBrief");
  const scriptSceneNumber =
    importedFirstScene?.script_scene_number ??
    formString(formData, "scriptSceneNumber");
  const scriptPages =
    importedFirstScene?.script_pages ??
    formString(formData, "scriptPages");
  const intent = formString(formData, "intent");

  if (!projectName || !firstSceneName) {
    formError(
      "/projects/new",
      "Give the project a name and either import scene JSON or enter the first scene.",
    );
  }

  const keywordAnalysis = importedFirstScene
    ? {
        keywords: importedFirstScene.search_keywords,
        status: "ready" as const,
      }
    : await analyzeSceneKeywords(searchBrief);
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

  const { error: sceneMetadataError } = await supabase
    .from("scenes")
    .update({
      script_scene_number: scriptSceneNumber || null,
      script_pages: scriptPages || null,
      generated_keywords: keywordAnalysis.keywords,
      keyword_generation_status: keywordAnalysis.status,
      keywords_generated_at: keywordAnalysis.keywords.length
        ? new Date().toISOString()
        : null,
    })
    .eq("id", result.scene_id)
    .eq("project_id", result.project_id);
  if (sceneMetadataError) {
    formError(
      scenePath(result.project_id, result.scene_id),
      "The project was created, but its first scene metadata could not be saved.",
    );
  }

  const remainingImportedScenes = sceneImport?.scenes.slice(1) ?? [];
  if (remainingImportedScenes.length) {
    const { error: importError } = await supabase.rpc(
      "import_project_scenes",
      {
        target_project_id: result.project_id,
        scene_payload: remainingImportedScenes,
      },
    );
    if (importError) {
      formError(
        `/projects/${result.project_id}`,
        "The project and first scene were created, but the remaining JSON scenes could not be imported.",
      );
    }
  }

  if (sceneImport) {
    revalidatePath(`/projects/${result.project_id}`);
    redirect(
      `/projects/${result.project_id}?imported=${sceneImport.scenes.length}`,
    );
  }

  if (intent === "find-plates") {
    redirect(`${scenePath(result.project_id, result.scene_id)}?created=1`);
  }
  redirect(`/projects/${result.project_id}?created=1#add-scene`);
}

export async function importScenes(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projectId = formString(formData, "projectId");
  const path = `/projects/${projectId}`;

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (!projectId) {
    formError("/projects", "Choose a valid project.");
  }

  const sceneImport = sceneImportFromForm(formData, path);
  if (!sceneImport) {
    formError(path, "Choose a scene JSON file to import.");
  }

  const { data: importedCount, error } = await supabase.rpc(
    "import_project_scenes",
    {
      target_project_id: projectId,
      scene_payload: sceneImport.scenes,
    },
  );
  if (error || importedCount !== sceneImport.scenes.length) {
    formError(
      path,
      "The scene JSON could not be imported. No scenes were added.",
    );
  }

  revalidatePath(path);
  redirect(`${path}?imported=${importedCount}`);
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

  const searchBrief = formString(formData, "searchBrief");
  const keywordAnalysis = await analyzeSceneKeywords(searchBrief);
  const { data: sceneId, error } = await supabase.rpc(
    "add_project_scene",
    {
      target_project_id: projectId,
      scene_name: sceneName,
      search_brief: searchBrief || undefined,
      script_scene_number:
        formString(formData, "scriptSceneNumber") || undefined,
      script_pages: formString(formData, "scriptPages") || undefined,
      generated_keywords: keywordAnalysis.keywords,
    },
  );

  if (error || !sceneId) {
    formError(
      `/projects/${projectId}`,
      "The scene could not be added. Please try again.",
    );
  }

  if (formString(formData, "intent") === "add-another") {
    redirect(`/projects/${projectId}?added=1#add-scene`);
  }
  redirect(`/projects/${projectId}/scenes/${sceneId}?created=1`);
}

export async function updateScene(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projectId = formString(formData, "projectId");
  const sceneId = formString(formData, "sceneId");
  const path = scenePath(projectId, sceneId);

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  const sceneName = formString(formData, "sceneName");
  const searchBrief = formString(formData, "searchBrief");
  if (!projectId || !sceneId || !sceneName) {
    formError(path, "Give the scene a title.");
  }

  const keywordAnalysis = await analyzeSceneKeywords(searchBrief);
  const { error } = await supabase.rpc("update_project_scene", {
    target_scene_id: sceneId,
    scene_name: sceneName,
    search_brief: searchBrief || undefined,
    script_scene_number:
      formString(formData, "scriptSceneNumber") || undefined,
    script_pages: formString(formData, "scriptPages") || undefined,
    generated_keywords: keywordAnalysis.keywords,
  });
  if (error) {
    formError(path, "The scene could not be updated. Please try again.");
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(path);
  redirect(`${path}?updated=1`);
}

export async function refreshSceneKeywords(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projectId = formString(formData, "projectId");
  const sceneId = formString(formData, "sceneId");
  const path = scenePath(projectId, sceneId);

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }

  const { data: scene, error: loadError } = await supabase
    .from("scenes")
    .select(
      "name, search_brief, script_scene_number, script_pages",
    )
    .eq("id", sceneId)
    .eq("project_id", projectId)
    .is("archived_at", null)
    .maybeSingle();
  if (loadError || !scene?.search_brief) {
    formError(path, "Add a scene description before generating keywords.");
  }

  let keywords: string[];
  try {
    keywords = await extractSceneKeywords(scene.search_brief);
  } catch {
    formError(
      path,
      "OpenAI keyword analysis is still unavailable. Check API credits and try again.",
    );
  }

  const { error } = await supabase.rpc("update_project_scene", {
    target_scene_id: sceneId,
    scene_name: scene.name,
    search_brief: scene.search_brief,
    script_scene_number: scene.script_scene_number || undefined,
    script_pages: scene.script_pages || undefined,
    generated_keywords: keywords,
  });
  if (error) {
    formError(path, "The generated keywords could not be saved.");
  }

  revalidatePath(path);
  redirect(`${path}?keywords=1`);
}

export async function archiveScene(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projectId = formString(formData, "projectId");
  const sceneId = formString(formData, "sceneId");
  const path = scenePath(projectId, sceneId);

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (!projectId || !sceneId) {
    formError(`/projects/${projectId}`, "Choose a valid scene.");
  }

  const { data: archivedProjectId, error } = await supabase.rpc(
    "archive_project_scene",
    { target_scene_id: sceneId },
  );
  if (error || archivedProjectId !== projectId) {
    formError(path, "The scene could not be deleted. Please try again.");
  }

  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}?deleted=1`);
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
      scenePath(projectId, sceneId),
      "Choose a valid catalog clip.",
    );
  }

  const { error } = await supabase.rpc("add_clip_to_scene", {
    target_scene_id: sceneId,
    target_stock_clip_id: stockClipId,
  });
  if (error) {
    formError(
      scenePath(projectId, sceneId),
      "The clip could not be added to this scene.",
    );
  }
  revalidatePath(scenePath(projectId, sceneId));
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
        scenePath(projectId, sceneId),
      )}`,
    );
  }
  if (
    !sceneClipId ||
    !statuses.has(status) ||
    !Number.isInteger(expectedVersion)
  ) {
    formError(
      scenePath(projectId, sceneId),
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
      scenePath(projectId, sceneId),
      "The clip changed in another session. Refresh and retry.",
    );
  }
  revalidatePath(scenePath(projectId, sceneId));
}
