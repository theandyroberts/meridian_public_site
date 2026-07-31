"use client";

import { useState } from "react";
import { archiveScene } from "@/app/projects/actions";

export function SceneDeleteForm({
  projectId,
  sceneId,
  sceneName,
}: {
  projectId: string;
  sceneId: string;
  sceneName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="danger-button"
        onClick={() => setConfirming(true)}
      >
        Delete scene
      </button>
    );
  }

  return (
    <form action={archiveScene} className="delete-scene-confirmation">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sceneId" value={sceneId} />
      <p>
        Delete <strong>{sceneName}</strong>? It will be removed from this
        project and its clip list will be archived with it.
      </p>
      <div className="form-actions">
        <button type="submit" className="danger-button">
          Yes, delete scene
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
