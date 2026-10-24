export type ProjectAutosaveStatus =
  | "saved"
  | "dirty"
  | "saving"
  | "error";

export type ProjectAutosaveState = {
  status: ProjectAutosaveStatus;
  revision: number;
  submittedRevision: number | null;
  error: string | null;
};

export type ProjectAutosaveEvent =
  | { type: "changed"; revision: number }
  | { type: "save-started"; revision: number }
  | { type: "save-succeeded"; revision: number }
  | { type: "save-failed"; revision: number; error: string };

export const initialProjectAutosaveState: ProjectAutosaveState = {
  status: "saved",
  revision: 0,
  submittedRevision: null,
  error: null,
};

export function projectAutosaveReducer(
  state: ProjectAutosaveState,
  event: ProjectAutosaveEvent,
): ProjectAutosaveState {
  if (event.type === "changed") {
    return {
      ...state,
      status: "dirty",
      revision: event.revision,
      error: null,
    };
  }

  if (event.type === "save-started") {
    return {
      ...state,
      status: "saving",
      submittedRevision: event.revision,
      error: null,
    };
  }

  if (event.type === "save-succeeded") {
    const newerChangesExist = state.revision !== event.revision;
    return {
      ...state,
      status: newerChangesExist ? "dirty" : "saved",
      submittedRevision: null,
      error: null,
    };
  }

  const newerChangesExist = state.revision !== event.revision;
  return {
    ...state,
    status: newerChangesExist ? "dirty" : "error",
    submittedRevision: null,
    error: newerChangesExist ? null : event.error,
  };
}

export function projectEditNeedsUnloadWarning(
  status: ProjectAutosaveStatus,
): boolean {
  return status === "dirty" || status === "saving" || status === "error";
}
