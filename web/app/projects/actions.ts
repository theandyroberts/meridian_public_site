"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  SceneImportError,
  type SceneImportDocument,
  parseSceneImportJson,
} from "@/lib/sceneImport";
import {
  analyzeSceneSearchBrief,
} from "@/lib/sceneKeywords";
import {
  parseRoughShot,
  parseSceneStageChoice,
  parseSceneVehicle,
  preserveNiceToHavePriority,
} from "@/lib/sceneConfiguration";
import {
  EMPTY_SCENE_PRODUCTION_METADATA,
  parseStageUseType,
  sceneProductionMetadataFromForm,
} from "@/lib/sceneProduction";
import { createClient } from "@/lib/supabase/server";

function formString(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function formVehicle(formData: FormData) {
  return parseSceneVehicle(formString(formData, "vehicle"));
}

function projectStageUpdate(formData: FormData):
  | {
      production_approach: "listed_led_stage";
      stage_profile_id: string;
      custom_stage_name: null;
    }
  | {
      production_approach: "undecided" | "vfx_no_led_wall";
      stage_profile_id: null;
      custom_stage_name: null;
    }
  | null {
  const choice = formString(formData, "stageChoice");
  if (choice === "undecided" || choice === "vfx_no_led_wall") {
    return {
      production_approach: choice,
      stage_profile_id: null,
      custom_stage_name: null,
    };
  }

  if (
    choice.startsWith("stage:") &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      choice.slice(6),
    )
  ) {
    return {
      production_approach: "listed_led_stage",
      stage_profile_id: choice.slice(6),
      custom_stage_name: null,
    };
  }

  return null;
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

async function analyzeScene(description: string): Promise<{
  keywords: string[];
  searchIntentSummary: string;
  productionMetadata: typeof EMPTY_SCENE_PRODUCTION_METADATA;
  status: "not_needed" | "pending" | "ready";
}> {
  if (!description.trim()) {
    return {
      keywords: [],
      searchIntentSummary: "",
      productionMetadata: EMPTY_SCENE_PRODUCTION_METADATA,
      status: "not_needed",
    };
  }

  try {
    const analysis = await analyzeSceneSearchBrief(description);
    return {
      ...analysis,
      status: "ready",
    };
  } catch (error) {
    console.warn(
      `Scene saved with AI keyword analysis pending: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return {
      keywords: [],
      searchIntentSummary: "",
      productionMetadata: EMPTY_SCENE_PRODUCTION_METADATA,
      status: "pending",
    };
  }
}

export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/projects/new");

  const organizationName = formString(formData, "organizationName");
  const projectName =
    formString(formData, "workingTitle") ||
    formString(formData, "projectName");
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
      "Give the project a working title and either import scene JSON or enter the first scene.",
    );
  }

  const sceneAnalysis = importedFirstScene
    ? {
        keywords: importedFirstScene.search_keywords,
        searchIntentSummary: importedFirstScene.search_intent_summary,
        productionMetadata: importedFirstScene.production_metadata,
        status: "ready" as const,
      }
    : await analyzeScene(searchBrief);
  const { data, error } = await supabase.rpc("start_project", {
    organization_name: organizationName,
    project_name: projectName,
    first_scene_name: firstSceneName,
    search_brief: searchBrief || undefined,
    display_name: formString(formData, "displayName") || undefined,
    actual_title: formString(formData, "actualTitle") || undefined,
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
      vehicle: formVehicle(formData),
      script_scene_number: scriptSceneNumber || null,
      script_pages: scriptPages || null,
      generated_keywords: sceneAnalysis.keywords,
      search_intent_summary: sceneAnalysis.searchIntentSummary || null,
      continuity_group: importedFirstScene?.continuity_group || null,
      stage_use_type: importedFirstScene?.stage_use_type ?? "vehicle_process",
      production_metadata: sceneAnalysis.productionMetadata,
      keyword_generation_status: sceneAnalysis.status,
      keywords_generated_at: sceneAnalysis.keywords.length
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

export type ProjectSaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: string; authenticationRequired?: boolean };

async function persistProjectDetails(
  formData: FormData,
): Promise<ProjectSaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projectId = formString(formData, "projectId");
  const path = `/projects/${projectId}`;

  if (!user) {
    return {
      ok: false,
      error: "Your session expired. Sign in again before retrying this save.",
      authenticationRequired: true,
    };
  }

  const workingTitle = formString(formData, "workingTitle");
  if (!projectId || !workingTitle) {
    return {
      ok: false,
      error: "Give the project a working title or code name.",
    };
  }

  const dueDate = formString(formData, "dueDate");
  const { error } = await supabase.rpc("update_project_details", {
    target_project_id: projectId,
    working_title: workingTitle,
    actual_title: formString(formData, "actualTitle") || undefined,
    client_name: formString(formData, "clientName") || undefined,
    project_description:
      formString(formData, "projectDescription") || undefined,
    project_due_date: dueDate || undefined,
  });
  if (error) {
    return {
      ok: false,
      error: "The project details could not be saved. Please try again.",
    };
  }

  const stageUpdate = projectStageUpdate(formData);
  if (stageUpdate) {
    const { error: stageError } = await supabase
      .from("projects")
      .update(stageUpdate)
      .eq("id", projectId);
    if (stageError) {
      return {
        ok: false,
        error: "The project details were saved, but its stage was not.",
      };
    }
  }

  revalidatePath("/projects");
  revalidatePath(path);
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function saveProjectDetails(
  formData: FormData,
): Promise<ProjectSaveResult> {
  return persistProjectDetails(formData);
}

export async function updateProject(formData: FormData) {
  const projectId = formString(formData, "projectId");
  const path = `/projects/${projectId}`;
  const result = await persistProjectDetails(formData);

  if (!result.ok) {
    if (result.authenticationRequired) {
      redirect(`/login?next=${encodeURIComponent(path)}`);
    }
    formError(path, result.error);
  }

  redirect(`${path}?updated=1`);
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
  const sceneAnalysis = await analyzeScene(searchBrief);
  const { data: sceneId, error } = await supabase.rpc(
    "add_project_scene",
    {
      target_project_id: projectId,
      scene_name: sceneName,
      search_brief: searchBrief || undefined,
      script_scene_number:
        formString(formData, "scriptSceneNumber") || undefined,
      script_pages: formString(formData, "scriptPages") || undefined,
      generated_keywords: sceneAnalysis.keywords,
    },
  );

  if (error || !sceneId) {
    formError(
      `/projects/${projectId}`,
      "The scene could not be added. Please try again.",
    );
  }
  const { error: vehicleError } = await supabase
    .from("scenes")
    .update({
      vehicle: formVehicle(formData),
      search_intent_summary: sceneAnalysis.searchIntentSummary || null,
      production_metadata: sceneAnalysis.productionMetadata,
      keyword_generation_status: sceneAnalysis.status,
      keywords_generated_at: sceneAnalysis.keywords.length
        ? new Date().toISOString()
        : null,
    })
    .eq("id", sceneId)
    .eq("project_id", projectId);
  if (vehicleError) {
    formError(
      scenePath(projectId, sceneId),
      "The scene was created, but its vehicle could not be saved.",
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
  const searchIntentSummary = formString(formData, "searchIntentSummary");
  if (!projectId || !sceneId || !sceneName) {
    formError(path, "Give the scene a title.");
  }
  if (!searchIntentSummary) {
    formError(
      path,
      "Add a one-sentence search summary so collaborators can understand what the scene needs.",
    );
  }
  if (searchIntentSummary.length > 320) {
    formError(path, "Keep the search summary to 320 characters or fewer.");
  }

  const { data: currentPriorities, error: prioritiesError } = await supabase
    .from("scenes")
    .select("nice_to_have_keywords")
    .eq("id", sceneId)
    .eq("project_id", projectId)
    .is("archived_at", null)
    .maybeSingle();
  if (prioritiesError || !currentPriorities) {
    formError(path, "The scene search priorities could not be loaded.");
  }

  const keywordAnalysis = await analyzeScene(searchBrief);
  const prioritizedKeywords = preserveNiceToHavePriority(
    keywordAnalysis.keywords,
    currentPriorities.nice_to_have_keywords,
  );
  const { error } = await supabase.rpc("update_project_scene", {
    target_scene_id: sceneId,
    scene_name: sceneName,
    search_brief: searchBrief || undefined,
    script_scene_number:
      formString(formData, "scriptSceneNumber") || undefined,
    script_pages: formString(formData, "scriptPages") || undefined,
    generated_keywords: prioritizedKeywords.mustHave,
  });
  if (error) {
    formError(path, "The scene could not be updated. Please try again.");
  }
  const sceneStageUpdate = parseSceneStageChoice(
    formString(formData, "stageChoice"),
  );
  const { error: configurationError } = await supabase
    .from("scenes")
    .update({
      vehicle: formVehicle(formData),
      rough_shot: parseRoughShot(formString(formData, "roughShot")),
      search_intent_summary: searchIntentSummary,
      continuity_group:
        formString(formData, "continuityGroup").toLocaleLowerCase() || null,
      stage_use_type: parseStageUseType(
        formString(formData, "stageUseType"),
      ),
      production_metadata: sceneProductionMetadataFromForm(formData),
      nice_to_have_keywords: prioritizedKeywords.niceToHave,
      keyword_generation_status: keywordAnalysis.status,
      keywords_generated_at:
        keywordAnalysis.status === "ready" ? new Date().toISOString() : null,
      ...(sceneStageUpdate ?? {}),
    })
    .eq("id", sceneId)
    .eq("project_id", projectId);
  if (configurationError) {
    formError(
      path,
      "The scene details were saved, but its production configuration was not.",
    );
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
      "name, search_brief, search_intent_summary, script_scene_number, script_pages, nice_to_have_keywords",
    )
    .eq("id", sceneId)
    .eq("project_id", projectId)
    .is("archived_at", null)
    .maybeSingle();
  if (loadError || !scene?.search_brief) {
    formError(path, "Add a scene description before generating keywords.");
  }

  let analysis: Awaited<ReturnType<typeof analyzeSceneSearchBrief>>;
  try {
    analysis = await analyzeSceneSearchBrief(scene.search_brief);
  } catch {
    formError(
      path,
      "OpenAI keyword analysis is still unavailable. Check API credits and try again.",
    );
  }

  const prioritizedKeywords = preserveNiceToHavePriority(
    analysis.keywords,
    scene.nice_to_have_keywords,
  );

  const { error } = await supabase.rpc("update_project_scene", {
    target_scene_id: sceneId,
    scene_name: scene.name,
    search_brief: scene.search_brief,
    script_scene_number: scene.script_scene_number || undefined,
    script_pages: scene.script_pages || undefined,
    generated_keywords: prioritizedKeywords.mustHave,
  });
  if (error) {
    formError(path, "The generated keywords could not be saved.");
  }

  const { error: priorityError } = await supabase
    .from("scenes")
    .update({
      nice_to_have_keywords: prioritizedKeywords.niceToHave,
      ...(scene.search_intent_summary
        ? {}
        : {
            search_intent_summary: analysis.searchIntentSummary,
            production_metadata: analysis.productionMetadata,
          }),
      keyword_generation_status: "ready",
      keywords_generated_at: new Date().toISOString(),
    })
    .eq("id", sceneId)
    .eq("project_id", projectId);
  if (priorityError) {
    formError(path, "The generated keyword priorities could not be saved.");
  }

  revalidatePath(path);
  redirect(`${path}?keywords=1`);
}

export async function moveSceneKeywordPriority(formData: FormData) {
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

  const keyword = formString(formData, "keyword").toLocaleLowerCase();
  const targetPriority = formString(formData, "targetPriority");
  if (
    !projectId ||
    !sceneId ||
    !keyword ||
    !new Set(["must", "nice"]).has(targetPriority)
  ) {
    formError(path, "Choose a valid descriptor and priority.");
  }

  const { data: scene, error: loadError } = await supabase
    .from("scenes")
    .select("generated_keywords, nice_to_have_keywords")
    .eq("id", sceneId)
    .eq("project_id", projectId)
    .is("archived_at", null)
    .maybeSingle();
  if (loadError || !scene) {
    formError(path, "The scene descriptors could not be loaded.");
  }

  const mustHave = new Set(
    scene.generated_keywords.map((value) => value.toLocaleLowerCase()),
  );
  const niceToHave = new Set(
    scene.nice_to_have_keywords.map((value) => value.toLocaleLowerCase()),
  );
  if (!mustHave.has(keyword) && !niceToHave.has(keyword)) {
    formError(path, "That descriptor is no longer part of this scene.");
  }
  mustHave.delete(keyword);
  niceToHave.delete(keyword);
  if (targetPriority === "must") mustHave.add(keyword);
  if (targetPriority === "nice") niceToHave.add(keyword);

  const { error } = await supabase
    .from("scenes")
    .update({
      generated_keywords: [...mustHave],
      nice_to_have_keywords: [...niceToHave],
    })
    .eq("id", sceneId)
    .eq("project_id", projectId);
  if (error) {
    formError(path, "The descriptor priority could not be changed.");
  }

  revalidatePath(path);
  redirect(`${path}?priorities=1`);
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
  revalidatePath(`/projects/${projectId}`);
}
