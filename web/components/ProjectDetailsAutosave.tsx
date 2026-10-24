"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { saveProjectDetails } from "@/app/projects/actions";
import {
  initialProjectAutosaveState,
  projectAutosaveReducer,
  projectEditNeedsUnloadWarning,
} from "@/lib/projectAutosave";
import styles from "./ProjectDetailsAutosave.module.css";

const AUTOSAVE_DELAY_MS = 1000;

type ProjectDetailsAutosaveProps = {
  project: {
    id: string;
    name: string;
    actualTitle: string;
    clientName: string;
    dueDate: string;
    description: string;
  };
  stages: Array<{ id: string; name: string }>;
  stageChoice: string;
  customStageName?: string;
};

type FailedSave = {
  payload: FormData;
  revision: number;
};

function cloneFormData(source: FormData): FormData {
  const clone = new FormData();
  for (const [name, value] of source.entries()) clone.append(name, value);
  return clone;
}

export function ProjectDetailsAutosave({
  project,
  stages,
  stageChoice,
  customStageName,
}: ProjectDetailsAutosaveProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);
  const failedSaveRef = useRef<FailedSave | null>(null);
  const [state, dispatch] = useReducer(
    projectAutosaveReducer,
    initialProjectAutosaveState,
  );

  const clearScheduledSave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const submitSnapshot = useCallback(
    async (payload: FormData, revision: number) => {
      clearScheduledSave();
      dispatch({ type: "save-started", revision });
      const result = await saveProjectDetails(cloneFormData(payload));

      if (result.ok) {
        if (
          failedSaveRef.current &&
          failedSaveRef.current.revision <= revision
        ) {
          failedSaveRef.current = null;
        }
        dispatch({ type: "save-succeeded", revision });
        return;
      }

      failedSaveRef.current = {
        payload: cloneFormData(payload),
        revision,
      };
      dispatch({
        type: "save-failed",
        revision,
        error: result.error,
      });
    },
    [clearScheduledSave],
  );

  const scheduleAutosave = useCallback(() => {
    const form = formRef.current;
    if (!form) return;

    clearScheduledSave();
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    dispatch({ type: "changed", revision });
    timeoutRef.current = setTimeout(() => {
      const currentForm = formRef.current;
      if (!currentForm) return;
      void submitSnapshot(new FormData(currentForm), revision);
    }, AUTOSAVE_DELAY_MS);
  }, [clearScheduledSave, submitSnapshot]);

  useEffect(() => clearScheduledSave, [clearScheduledSave]);

  useEffect(() => {
    if (!projectEditNeedsUnloadWarning(state.status)) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [state.status]);

  const saveNow = () => {
    const form = formRef.current;
    if (!form) return;
    const revision = revisionRef.current;
    void submitSnapshot(new FormData(form), revision);
  };

  const retryFailedSave = () => {
    const failedSave = failedSaveRef.current;
    if (!failedSave) return;
    void submitSnapshot(failedSave.payload, failedSave.revision);
  };

  const statusMessage =
    state.status === "saving"
      ? "Saving…"
      : state.status === "dirty"
        ? "Unsaved changes"
        : state.status === "error"
          ? `Save failed · ${state.error}`
          : "Saved";

  return (
    <form
      ref={formRef}
      className="workspace-form compact-form"
      onChange={scheduleAutosave}
      onSubmit={(event) => {
        event.preventDefault();
        saveNow();
      }}
    >
      <input type="hidden" name="projectId" value={project.id} />
      <div className="form-grid">
        <label>
          <span>Working title or code name</span>
          <input
            name="workingTitle"
            type="text"
            defaultValue={project.name}
            maxLength={200}
            required
          />
        </label>
        <label>
          <span>
            Actual production title <em>optional · private</em>
          </span>
          <input
            name="actualTitle"
            type="text"
            defaultValue={project.actualTitle}
            placeholder="Leave blank unless it is useful"
            maxLength={200}
            autoComplete="off"
          />
        </label>
        <label>
          <span>Client <em>optional</em></span>
          <input
            name="clientName"
            type="text"
            defaultValue={project.clientName}
            maxLength={200}
          />
        </label>
        <label>
          <span>Needed by <em>optional</em></span>
          <input
            name="dueDate"
            type="date"
            defaultValue={project.dueDate}
          />
        </label>
        <label>
          <span>Stage</span>
          <select name="stageChoice" defaultValue={stageChoice}>
            {stages.map((stage) => (
              <option key={stage.id} value={`stage:${stage.id}`}>
                {stage.name}
              </option>
            ))}
            {stageChoice === "keep_custom" && (
              <option value="keep_custom">
                {customStageName || "Custom LED stage"}
              </option>
            )}
            <option value="undecided">Undecided</option>
            <option value="vfx_no_led_wall">VFX / no LED wall</option>
          </select>
        </label>
      </div>
      <label>
        <span>Internal project notes <em>optional</em></span>
        <textarea
          name="projectDescription"
          defaultValue={project.description}
          rows={3}
          placeholder="Production context, stage constraints, delivery notes…"
        />
      </label>
      <div className={styles.statusRow} aria-live="polite">
        <span className={styles.status} data-state={state.status}>
          {statusMessage}
        </span>
        {state.status === "error" && failedSaveRef.current && (
          <button
            type="button"
            className={`secondary-button ${styles.retry}`}
            onClick={retryFailedSave}
          >
            Retry last save
          </button>
        )}
        <button type="submit" className="primary-button">
          Save now
        </button>
      </div>
    </form>
  );
}
