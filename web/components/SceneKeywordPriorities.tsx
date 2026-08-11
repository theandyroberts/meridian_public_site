import { moveSceneKeywordPriority } from "@/app/projects/actions";
import styles from "./SceneKeywordPriorities.module.css";

type SceneKeywordPrioritiesProps = {
  projectId: string;
  sceneId: string;
  mustHave: string[];
  niceToHave: string[];
};

function KeywordList({
  projectId,
  sceneId,
  keywords,
  targetPriority,
  targetLabel,
}: {
  projectId: string;
  sceneId: string;
  keywords: string[];
  targetPriority: "must" | "nice";
  targetLabel: string;
}) {
  if (!keywords.length) {
    return <span className={styles.empty}>No descriptors in this list.</span>;
  }

  return (
    <div className={styles.list}>
      {keywords.map((keyword) => (
        <form
          action={moveSceneKeywordPriority}
          className={styles.chipForm}
          key={keyword}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="sceneId" value={sceneId} />
          <input type="hidden" name="keyword" value={keyword} />
          <input
            type="hidden"
            name="targetPriority"
            value={targetPriority}
          />
          <button
            type="submit"
            className={`${styles.chip} mono`}
            title={`Move “${keyword}” to ${targetLabel}`}
            aria-label={`Move “${keyword}” to ${targetLabel}`}
          >
            {keyword} → {targetPriority === "nice" ? "nice" : "must"}
          </button>
        </form>
      ))}
    </div>
  );
}

export function SceneKeywordPriorities({
  projectId,
  sceneId,
  mustHave,
  niceToHave,
}: SceneKeywordPrioritiesProps) {
  return (
    <section className={styles.card} aria-labelledby="search-priority-heading">
      <div className={styles.heading}>
        <h2 id="search-priority-heading">Search priorities</h2>
        <span>Choose a descriptor to move it to the other list.</span>
      </div>
      <div className={styles.group}>
        <p>Must Have</p>
        <small>Primary requirements for a useful plate match.</small>
        <KeywordList
          projectId={projectId}
          sceneId={sceneId}
          keywords={mustHave}
          targetPriority="nice"
          targetLabel="Nice to Have"
        />
      </div>
      <div className={styles.group}>
        <p>Nice to Have</p>
        <small>Preferences that improve a match without ruling it out.</small>
        <KeywordList
          projectId={projectId}
          sceneId={sceneId}
          keywords={niceToHave}
          targetPriority="must"
          targetLabel="Must Have"
        />
      </div>
    </section>
  );
}
