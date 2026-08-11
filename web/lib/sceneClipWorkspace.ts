export const SCENE_CLIP_STATUSES = [
  "considering",
  "shortlisted",
  "selected",
  "rejected",
  "submitted",
] as const;

export type SceneClipStatus = (typeof SCENE_CLIP_STATUSES)[number];
export type SceneClipWorkspaceTab = "considering" | "selected" | "rejected";

export type SceneClipStatusUpdate = {
  status: SceneClipStatus;
  expectedVersion: number;
};

export function parseSceneClipStatusUpdate(
  value: unknown,
): SceneClipStatusUpdate | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const status = String(input.status ?? "") as SceneClipStatus;
  const expectedVersion = Number(input.expectedVersion);
  if (
    !SCENE_CLIP_STATUSES.includes(status) ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    return null;
  }
  return { status, expectedVersion };
}

export function sceneClipWorkspaceTab(
  status: SceneClipStatus,
): SceneClipWorkspaceTab {
  if (status === "rejected") return "rejected";
  if (status === "selected" || status === "submitted") return "selected";
  return "considering";
}
