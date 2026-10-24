"use client";

import { useId, useState } from "react";
import { updateSceneClipStatus } from "@/app/projects/actions";

type SceneClipStatus =
  | "considering"
  | "shortlisted"
  | "selected"
  | "rejected"
  | "submitted";

type SceneClipStatusControlProps = {
  projectId: string;
  sceneId: string;
  sceneClipId: string;
  status: SceneClipStatus;
  version: number;
};

function AutoSaveStatusSelect({
  status,
  saveState,
}: {
  status: SceneClipStatus;
  saveState: "idle" | "saving" | "saved";
}) {
  const feedbackId = useId();
  const pending = saveState === "saving";

  return (
    <>
      <label className="scene-clip-status-label">
        <span className="sr-only">Saved clip status</span>
        <select
          name="status"
          defaultValue={status}
          disabled={pending}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          aria-describedby={feedbackId}
        >
          <option value="considering">Considering</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="selected">Selected</option>
          <option value="rejected">Rejected</option>
          <option value="submitted">Submitted</option>
        </select>
      </label>
      <span
        id={feedbackId}
        className="scene-clip-status-feedback mono"
        role="status"
        aria-live="polite"
      >
        {pending ? "Saving…" : saveState === "saved" ? "Saved" : "Auto-saves"}
      </span>
    </>
  );
}

export function SceneClipStatusControl({
  projectId,
  sceneId,
  sceneClipId,
  status,
  version,
}: SceneClipStatusControlProps) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  async function saveStatus(formData: FormData) {
    setSaveState("saving");
    try {
      await updateSceneClipStatus(formData);
      setSaveState("saved");
    } catch (error) {
      setSaveState("idle");
      throw error;
    }
  }

  return (
    <form action={saveStatus} className="scene-clip-form">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sceneId" value={sceneId} />
      <input type="hidden" name="sceneClipId" value={sceneClipId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <AutoSaveStatusSelect status={status} saveState={saveState} />
    </form>
  );
}
