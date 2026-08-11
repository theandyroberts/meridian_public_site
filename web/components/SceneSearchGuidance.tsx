import Link from "next/link";
import type { Plate } from "@platelab/shared";
import {
  assessPlateStageCompatibility,
  browseParamsForSceneFilters,
  sceneStageSearchGuidance,
  sceneStructuredFilterChips,
  type ProductionApproach,
} from "@/lib/sceneSearchGuidance";
import styles from "./SceneSearchGuidance.module.css";

export function SceneSearchGuidance({
  structuredFilters,
  productionApproach,
  stageLabel,
}: {
  structuredFilters: unknown;
  productionApproach: ProductionApproach;
  stageLabel?: string | null;
}) {
  const chips = sceneStructuredFilterChips(structuredFilters);
  const browseParams = browseParamsForSceneFilters(structuredFilters);
  const stageGuidance = sceneStageSearchGuidance({
    productionApproach,
    stageLabel,
  });

  return (
    <section className={styles.panel} aria-labelledby="scene-filters-heading">
      <div className={styles.heading}>
        <strong id="scene-filters-heading">Search filters</strong>
        <span>Structured requirements applied to catalog matching</span>
      </div>
      {chips.length ? (
        <div className={styles.chips}>
          {chips.map((chip) => (
            <span className={`${styles.chip} mono`} key={chip.key}>
              <span>{chip.label}:</span> {chip.value}
            </span>
          ))}
        </div>
      ) : (
        <span className={styles.empty}>
          No structured filters are limiting this scene’s search.
        </span>
      )}
      <div className={styles.actions}>
        <span className={styles.empty}>
          Text descriptors still guide semantic and keyword matching.
        </span>
        {browseParams.size > 0 && (
          <Link
            className={`${styles.browseLink} mono`}
            href={`/browse?${browseParams}`}
          >
            Browse with these filters →
          </Link>
        )}
      </div>
      <p className={styles.stageGuidance} data-tone="neutral">
        <strong>Stage guidance:</strong> {stageGuidance}
      </p>
    </section>
  );
}

export function PlateStageCompatibilityWarning({
  plateStageCompat,
  productionApproach,
  stageLabel,
}: {
  plateStageCompat: Plate["stageCompat"];
  productionApproach: ProductionApproach;
  stageLabel?: string | null;
}) {
  const assessment = assessPlateStageCompatibility({
    productionApproach,
    stageLabel,
    plateStageCompat,
  });
  if (assessment.tone !== "warning") return null;
  return (
    <p className={styles.warning} role="note">
      <strong>Stage check:</strong> {assessment.message}
    </p>
  );
}
