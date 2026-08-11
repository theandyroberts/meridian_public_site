export type SceneClipStatus =
  | "considering"
  | "shortlisted"
  | "selected"
  | "rejected"
  | "submitted";

type SceneClipStatusRow = {
  status: SceneClipStatus;
};

export function sceneClipCounts(rows: SceneClipStatusRow[] | null | undefined) {
  return (rows ?? []).reduce(
    (counts, row) => {
      if (row.status === "considering") counts.considering += 1;
      if (row.status === "selected") counts.selected += 1;
      return counts;
    },
    { considering: 0, selected: 0 },
  );
}
