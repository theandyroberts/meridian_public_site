"use client";

import { useId, useMemo, useState } from "react";
import {
  MAX_SCENE_IMPORT_BYTES,
  SCENE_EXTRACTION_PROMPT,
  SceneImportError,
  type SceneImportScene,
  parseSceneImportJson,
  serializeSceneImportDocument,
} from "@/lib/sceneImport";

type SceneImportPanelProps =
  | {
      variant: "new-project";
    }
  | {
      variant: "existing-project";
      projectId: string;
      action: (formData: FormData) => void | Promise<void>;
    };

function updateScene(
  scenes: SceneImportScene[],
  index: number,
  update: Partial<SceneImportScene>,
): SceneImportScene[] {
  return scenes.map((scene, sceneIndex) =>
    sceneIndex === index ? { ...scene, ...update } : scene,
  );
}

export function SceneImportPanel(props: SceneImportPanelProps) {
  const fileInputId = useId();
  const [scenes, setScenes] = useState<SceneImportScene[]>([]);
  const [keywordDrafts, setKeywordDrafts] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const payload = useMemo(() => {
    if (!scenes.length) return "";
    try {
      return serializeSceneImportDocument(scenes);
    } catch {
      return "";
    }
  }, [scenes]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(SCENE_EXTRACTION_PROMPT);
      setCopyStatus("Prompt copied.");
    } catch {
      setCopyStatus("Copy failed. Select the prompt text below.");
    }
  }

  async function loadFile(file: File | undefined) {
    setError("");
    setScenes([]);
    setKeywordDrafts([]);
    setFileName("");
    if (!file) return;
    if (file.size > MAX_SCENE_IMPORT_BYTES) {
      setError("The JSON file must be smaller than 1 MB.");
      return;
    }

    try {
      const document = parseSceneImportJson(await file.text());
      setScenes(document.scenes);
      setKeywordDrafts(
        document.scenes.map((scene) => scene.search_keywords.join(", ")),
      );
      setFileName(file.name);
    } catch (loadError) {
      setError(
        loadError instanceof SceneImportError
          ? loadError.message
          : "The scene file could not be read.",
      );
    }
  }

  const content = (
    <section className="scene-import-panel">
      <div className="scene-import-heading">
        <div>
          <p className="mono accent">Private script workflow</p>
          <h2>Import scenes from JSON</h2>
          <p>
            Your script never comes to The Plate Lab. Run the prompt in the AI
            tool of your choice, review its JSON locally, then import only the
            scene briefs you approve.
          </p>
        </div>
        <span className="privacy-chip mono">Script stays with you</span>
      </div>

      <details className="scene-import-prompt">
        <summary>1. Copy the script-scanning prompt</summary>
        <div className="scene-import-prompt-body">
          <p>
            Attach the screenplay directly to your AI tool, paste this prompt,
            and save its response as a <code>.json</code> file.
          </p>
          <textarea
            aria-label="Script-scanning prompt"
            value={SCENE_EXTRACTION_PROMPT}
            readOnly
            rows={12}
          />
          <div className="inline-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={copyPrompt}
            >
              Copy prompt
            </button>
            {copyStatus && (
              <span className="mono dim" role="status">
                {copyStatus}
              </span>
            )}
          </div>
        </div>
      </details>

      <div className="scene-import-file-step">
        <div>
          <p className="mono accent">2. Review, then choose the JSON</p>
          <p className="dim">
            The browser validates and previews the file before anything is
            submitted.
          </p>
        </div>
        <label htmlFor={fileInputId} className="secondary-button file-button">
          Choose JSON file
        </label>
        <input
          id={fileInputId}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={(event) => loadFile(event.target.files?.[0])}
        />
      </div>

      {error && (
        <p className="auth-alert error" role="alert">
          {error}
        </p>
      )}

      {scenes.length > 0 && (
        <div className="scene-import-review">
          <div className="section-head compact">
            <div>
              <p className="mono accent">3. Approve the structured scenes</p>
              <h3>
                {scenes.length} scene{scenes.length === 1 ? "" : "s"} ready
              </h3>
              <p className="dim">
                {fileName} · Edit any field or remove scenes before import.
              </p>
            </div>
          </div>

          <div className="scene-import-list">
            {scenes.map((scene, index) => (
              <fieldset className="scene-import-row" key={index}>
                <legend className="mono">Scene {index + 1}</legend>
                <div className="form-grid">
                  <label>
                    <span>Scene name</span>
                    <input
                      value={scene.scene_name}
                      maxLength={200}
                      onChange={(event) =>
                        setScenes(
                          updateScene(scenes, index, {
                            scene_name: event.target.value,
                          }),
                        )
                      }
                    />
                  </label>
                  <div className="form-grid compact-metadata-grid">
                    <label>
                      <span>Script scene</span>
                      <input
                        value={scene.script_scene_number}
                        maxLength={40}
                        onChange={(event) =>
                          setScenes(
                            updateScene(scenes, index, {
                              script_scene_number: event.target.value,
                            }),
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>Page(s)</span>
                      <input
                        value={scene.script_pages}
                        maxLength={80}
                        onChange={(event) =>
                          setScenes(
                            updateScene(scenes, index, {
                              script_pages: event.target.value,
                            }),
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
                <label>
                  <span>Plate description</span>
                  <textarea
                    value={scene.description}
                    rows={4}
                    maxLength={12_000}
                    onChange={(event) =>
                      setScenes(
                        updateScene(scenes, index, {
                          description: event.target.value,
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  <span>AI search keywords</span>
                  <input
                    value={
                      keywordDrafts[index] ??
                      scene.search_keywords.join(", ")
                    }
                    onChange={(event) => {
                      const draft = event.target.value;
                      setKeywordDrafts(
                        keywordDrafts.map((value, draftIndex) =>
                          draftIndex === index ? draft : value,
                        ),
                      );
                      setScenes(
                        updateScene(scenes, index, {
                          search_keywords: draft
                            .split(",")
                            .map((keyword) => keyword.trim())
                            .filter(Boolean),
                        }),
                      );
                    }}
                  />
                  <small>Comma-separated. Keep 3–24 specific phrases.</small>
                </label>
                <button
                  type="button"
                  className="text-button danger-text-button"
                  onClick={() => {
                    setScenes(
                      scenes.filter(
                        (_, sceneIndex) => sceneIndex !== index,
                      ),
                    );
                    setKeywordDrafts(
                      keywordDrafts.filter(
                        (_, draftIndex) => draftIndex !== index,
                      ),
                    );
                  }}
                >
                  Remove from import
                </button>
              </fieldset>
            ))}
          </div>
        </div>
      )}

      <input type="hidden" name="sceneImportJson" value={payload} />
      {props.variant === "existing-project" && (
        <input type="hidden" name="projectId" value={props.projectId} />
      )}
      {scenes.length > 0 && !payload && (
        <p className="auth-alert error" role="alert">
          Fix the scene fields before importing. Every scene needs a name,
          description, and 3–24 keywords.
        </p>
      )}
      {props.variant === "existing-project" && scenes.length > 0 && (
        <button
          type="submit"
          className="primary-button scene-import-submit"
          disabled={!payload}
        >
          Import {scenes.length} approved scene
          {scenes.length === 1 ? "" : "s"}
        </button>
      )}
      {props.variant === "new-project" && scenes.length > 0 && (
        <button
          type="submit"
          name="intent"
          value="import-scenes"
          className="primary-button scene-import-submit"
          disabled={!payload}
        >
          Create project with {scenes.length} scene
          {scenes.length === 1 ? "" : "s"}
        </button>
      )}
    </section>
  );

  if (props.variant === "existing-project") {
    return (
      <form action={props.action} className="scene-import-form">
        {content}
      </form>
    );
  }
  return content;
}
