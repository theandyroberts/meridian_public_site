export type StudioSceneContext = {
  projectId: string;
  projectName: string;
  sceneId: string;
  sceneName: string;
};

export type StudioSelectionContext = {
  sceneClipId: string;
  version: number;
  inFrame: number | null;
  outFrame: number | null;
};

type StudioHrefInput = {
  video: string;
  label: string;
  fps: number;
  sourceTimecode?: string | null;
  sku?: string;
  scene?: StudioSceneContext;
  selection?: StudioSelectionContext;
};

export function buildStudioHref(input: StudioHrefInput): string {
  const query = new URLSearchParams({
    video: input.video,
    label: input.label,
    fps: String(input.fps),
  });

  if (input.sourceTimecode) query.set("sourceTimecode", input.sourceTimecode);
  if (input.sku) query.set("sku", input.sku);

  if (input.scene) {
    query.set("projectId", input.scene.projectId);
    query.set("projectName", input.scene.projectName);
    query.set("sceneId", input.scene.sceneId);
    query.set("sceneName", input.scene.sceneName);
  }

  if (input.selection) {
    query.set("sceneClipId", input.selection.sceneClipId);
    query.set("version", String(input.selection.version));
    if (
      Number.isSafeInteger(input.selection.inFrame) &&
      Number.isSafeInteger(input.selection.outFrame) &&
      input.selection.inFrame !== null &&
      input.selection.outFrame !== null &&
      input.selection.outFrame > input.selection.inFrame
    ) {
      query.set("inFrame", String(input.selection.inFrame));
      query.set("outFrame", String(input.selection.outFrame));
    }
  }

  return `/stage?${query}`;
}
