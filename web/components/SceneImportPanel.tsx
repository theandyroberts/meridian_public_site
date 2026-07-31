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
      setCopyStatus("Copy failed. Select the prompt text shown below.");
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
          <p className="mono accent">Script import</p>
          <h2>Load your scenes automatically</h2>
          <p>
            Your script stays in your Chat window. The Plate Lab receives only
            the scene file you review and choose to upload.
          </p>
        </div>
        <span className="privacy-chip mono">Script stays with you</span>
      </div>

      <ol className="scene-import-steps">
        <li className="scene-import-step">
          <span className="scene-import-step-number mono">1</span>
          <div>
            <h3>Copy the scene-prep prompt</h3>
            <p>
              This tells Chat how to find plate scenes and format the scene
              file for The Plate Lab.
            </p>
            <div className="inline-actions">
              <button
                type="button"
                className="primary-button"
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
        </li>

        <li className="scene-import-step">
          <span className="scene-import-step-number mono">2</span>
          <div>
            <h3>Paste the prompt and your script into Chat</h3>
            <p>
              Attach or paste the script in your Chat window. Review the
              scenes it finds, then save the response as a <code>.json</code>
              scene file.
            </p>
          </div>
        </li>

        <li className="scene-import-step scene-import-upload-step">
          <span className="scene-import-step-number mono">3</span>
          <div>
            <h3>Upload the scene file here</h3>
            <p>
              We validate the file and let you edit every scene before it is
              added to the project.
            </p>
          </div>
          <div className="scene-import-upload-action">
            <label htmlFor={fileInputId} className="secondary-button file-button">
              Upload scene file
            </label>
            {fileName && <span className="mono dim">{fileName}</span>}
          </div>
          <input
            id={fileInputId}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            onChange={(event) => loadFile(event.target.files?.[0])}
          />
        </li>
      </ol>

      {copyStatus.startsWith("Copy failed") && (
        <div className="scene-import-prompt-reference">
          <textarea
            aria-label="Script-scanning prompt"
            value={SCENE_EXTRACTION_PROMPT}
            readOnly
            rows={10}
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
      )}

      {error && (
        <p className="auth-alert error" role="alert">
          {error}
        </p>
      )}

      {scenes.length > 0 && (
        <div className="scene-import-review">
          <div className="section-head compact">
            <div>
              <p className="mono accent">Review before import</p>
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
