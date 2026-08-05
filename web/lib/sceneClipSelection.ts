export type SceneClipSelectionUpdate = {
  inFrame: number;
  outFrame: number;
  expectedVersion: number;
};

export function parseSceneClipSelectionUpdate(
  value: unknown,
): SceneClipSelectionUpdate | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const inFrame = Number(input.inFrame);
  const outFrame = Number(input.outFrame);
  const expectedVersion = Number(input.expectedVersion);

  if (
    !Number.isSafeInteger(inFrame) ||
    !Number.isSafeInteger(outFrame) ||
    !Number.isSafeInteger(expectedVersion) ||
    inFrame < 0 ||
    outFrame <= inFrame ||
    expectedVersion < 1
  ) {
    return null;
  }

  return { inFrame, outFrame, expectedVersion };
}

export function formatSceneClipSelectionDuration(
  inFrame: number | null,
  outFrame: number | null,
  fps: number,
): string | null {
  if (
    !Number.isSafeInteger(inFrame) ||
    !Number.isSafeInteger(outFrame) ||
    inFrame === null ||
    outFrame === null ||
    outFrame <= inFrame ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    return null;
  }

  const frames = outFrame - inFrame + 1;
  const seconds = frames / fps;
  return `${seconds.toFixed(2)} sec · ${frames} ${frames === 1 ? "frame" : "frames"}`;
}
