"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Plate } from "@platelab/shared";
import { publicMediaUrl } from "@/lib/publicMediaUrl";
import {
  sceneClipWorkspaceTab,
  type SceneClipStatus,
  type SceneClipWorkspaceTab,
} from "@/lib/sceneClipWorkspace";
import styles from "./SceneClipWorkspace.module.css";

export type SceneClipWorkspaceCandidate = {
  id: string;
  status: SceneClipStatus;
  version: number;
  plate: Plate;
  studioHref: string | null;
  selectedDuration: string | null;
};

const TAB_LABELS: Record<SceneClipWorkspaceTab, string> = {
  considering: "Considering",
  selected: "Selected",
  rejected: "Rejected",
};

export function SceneClipWorkspace({
  initialCandidates,
}: {
  initialCandidates: SceneClipWorkspaceCandidate[];
}) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [activeTab, setActiveTab] = useState<SceneClipWorkspaceTab>("considering");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState({ message: "", tone: "" });
  const counts = useMemo(() => {
    const next = { considering: 0, selected: 0, rejected: 0 };
    for (const candidate of candidates) next[sceneClipWorkspaceTab(candidate.status)] += 1;
    return next;
  }, [candidates]);
  const visible = candidates.filter(
    (candidate) => sceneClipWorkspaceTab(candidate.status) === activeTab,
  );

  async function updateStatus(candidate: SceneClipWorkspaceCandidate, status: SceneClipStatus) {
    setPendingId(candidate.id);
    setFeedback({ message: status === "rejected" ? "Rejecting candidate…" : "Restoring candidate…", tone: "" });
    try {
      const response = await fetch(
        `/api/scene-clips/${encodeURIComponent(candidate.id)}/status`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, expectedVersion: candidate.version }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The candidate could not be updated.");
      setCandidates((current) => current.map((item) =>
        item.id === candidate.id
          ? { ...item, status: result.status, version: result.version }
          : item,
      ));
      setFeedback({
        message: status === "rejected"
          ? `${candidate.plate.sku} moved to Rejected. Catalog footage was not deleted.`
          : `${candidate.plate.sku} restored to Considering.`,
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The candidate could not be updated.",
        tone: "error",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className={styles.workspace}>
      <div className={styles.tabs} role="tablist" aria-label="Scene candidate status">
        {(Object.keys(TAB_LABELS) as SceneClipWorkspaceTab[]).map((tab) => (
          <button
            key={tab}
            className={styles.tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls="scene-candidate-panel"
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]} ({counts[tab]})
          </button>
        ))}
      </div>
      <p
        className={styles.feedback}
        role="status"
        aria-live="polite"
        data-tone={feedback.tone}
      >
        {feedback.message}
      </p>
      <div id="scene-candidate-panel" role="tabpanel" aria-label={TAB_LABELS[activeTab]}>
        {visible.length ? (
          <div className={styles.grid}>
            {visible.map((candidate) => (
              <article key={candidate.id} className={styles.card}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.poster}
                  src={publicMediaUrl(candidate.plate.renditions.poster)}
                  alt={`Preview of ${candidate.plate.title}`}
                />
                <div className={styles.body}>
                  <p className="mono accent">{candidate.plate.sku}</p>
                  <h2>{candidate.plate.title}</h2>
                  <p className={styles.metadata}>
                    {candidate.plate.location.city}, {candidate.plate.location.region} · {candidate.plate.timeOfDay}
                  </p>
                  {candidate.selectedDuration && (
                    <p className={styles.metadata}>Saved range: {candidate.selectedDuration}</p>
                  )}
                  <div className={styles.actions}>
                    <Link className={styles.action} href={`/plate/${candidate.plate.sku}`}>
                      Plate details
                    </Link>
                    {candidate.studioHref && (
                      <Link className={styles.action} href={candidate.studioHref}>
                        Open in Studio
                      </Link>
                    )}
                    {candidate.status === "rejected" ? (
                      <button
                        className={styles.undo}
                        type="button"
                        disabled={pendingId === candidate.id}
                        onClick={() => updateStatus(candidate, "considering")}
                      >
                        Undo rejection
                      </button>
                    ) : (
                      <button
                        className={styles.reject}
                        type="button"
                        disabled={pendingId === candidate.id}
                        onClick={() => updateStatus(candidate, "rejected")}
                      >
                        Reject candidate
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <h2>No {TAB_LABELS[activeTab].toLowerCase()} clips</h2>
            <p>Changing a candidate status moves it between these tabs immediately.</p>
          </div>
        )}
      </div>
    </div>
  );
}
