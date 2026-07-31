"use client";

import { type ReactNode, useEffect, useState } from "react";

type SceneInputMode = "import" | "add" | null;

type SceneInputWorkspaceProps = {
  sceneCount: number;
  sceneTable: ReactNode;
  addScenePanel: ReactNode;
  importPanel: ReactNode;
};

export function SceneInputWorkspace({
  sceneCount,
  sceneTable,
  addScenePanel,
  importPanel,
}: SceneInputWorkspaceProps) {
  const [mode, setMode] = useState<SceneInputMode>(null);

  useEffect(() => {
    if (window.location.hash === "#add-scene") setMode("add");
    if (window.location.hash === "#import-scenes") setMode("import");
  }, []);

  function toggleMode(nextMode: Exclude<SceneInputMode, null>) {
    setMode((currentMode) => (currentMode === nextMode ? null : nextMode));
  }

  return (
    <section
      className={`project-detail-grid scene-workspace-grid ${
        mode === "add" ? "is-add-scene" : ""
      }`}
    >
      <div>
        <div className="section-head compact">
          <div>
            <h2>Scenes</h2>
          </div>
          <div className="scene-list-actions">
            <span className="mono dim">{sceneCount} total</span>
            <div
              className="scene-input-actions"
              role="group"
              aria-label="Add scenes"
            >
              <button
                type="button"
                className="secondary-button scene-input-button"
                aria-controls="import-scenes"
                aria-expanded={mode === "import"}
                onClick={() => toggleMode("import")}
              >
                Import
              </button>
              <button
                type="button"
                className="secondary-button scene-input-button"
                aria-controls="add-scene"
                aria-expanded={mode === "add"}
                onClick={() => toggleMode("add")}
              >
                + Add scene
              </button>
            </div>
          </div>
        </div>

        {sceneTable}
      </div>

      {mode === "add" && addScenePanel}
      {mode === "import" && (
        <div className="scene-workspace-panel" id="import-scenes">
          {importPanel}
        </div>
      )}
    </section>
  );
}
