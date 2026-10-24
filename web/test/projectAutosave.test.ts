import assert from "node:assert/strict";
import test from "node:test";
import {
  initialProjectAutosaveState,
  projectAutosaveReducer,
  projectEditNeedsUnloadWarning,
} from "../lib/projectAutosave";

test("project autosave reports a clean successful save", () => {
  const dirty = projectAutosaveReducer(initialProjectAutosaveState, {
    type: "changed",
    revision: 1,
  });
  const saving = projectAutosaveReducer(dirty, {
    type: "save-started",
    revision: 1,
  });
  const saved = projectAutosaveReducer(saving, {
    type: "save-succeeded",
    revision: 1,
  });

  assert.equal(saved.status, "saved");
  assert.equal(saved.error, null);
});

test("an older save cannot mark newer project edits as saved", () => {
  const saving = projectAutosaveReducer(
    { ...initialProjectAutosaveState, status: "dirty", revision: 1 },
    { type: "save-started", revision: 1 },
  );
  const changedAgain = projectAutosaveReducer(saving, {
    type: "changed",
    revision: 2,
  });
  const staleSuccess = projectAutosaveReducer(changedAgain, {
    type: "save-succeeded",
    revision: 1,
  });

  assert.equal(staleSuccess.status, "dirty");
  assert.equal(staleSuccess.revision, 2);
});

test("a current failure exposes an error for explicit retry", () => {
  const failed = projectAutosaveReducer(
    { ...initialProjectAutosaveState, status: "saving", revision: 3 },
    {
      type: "save-failed",
      revision: 3,
      error: "The project could not be saved.",
    },
  );

  assert.equal(failed.status, "error");
  assert.equal(failed.error, "The project could not be saved.");
});

test("dirty, saving, and failed project edits warn before navigation", () => {
  assert.equal(projectEditNeedsUnloadWarning("saved"), false);
  assert.equal(projectEditNeedsUnloadWarning("dirty"), true);
  assert.equal(projectEditNeedsUnloadWarning("saving"), true);
  assert.equal(projectEditNeedsUnloadWarning("error"), true);
});
