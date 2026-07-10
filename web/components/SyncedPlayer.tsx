"use client";

import { useEffect, useRef, useState } from "react";
import type { Plate } from "@platelab/shared";
import { GRID_ORDER, CAMERA_POSITIONS } from "@platelab/shared";

/**
 * Stitched master + 9-grid sync player.
 *
 * The stitched preview is the master clock. The nine camera tiles are
 * followers: a rAF loop measures each tile's drift from the master and
 * hard-corrects currentTime when drift exceeds the threshold. Play/pause/
 * seek propagate from the master to all followers. Grid order is the
 * array's canonical monitor layout: J G H / F A B / C D E.
 */

const DRIFT_THRESHOLD = 0.05; // seconds — just over one frame at 24fps

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 24);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export function SyncedPlayer({ plate }: { plate: Plate }) {
  const masterRef = useRef<HTMLVideoElement>(null);
  const tileRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(plate.media.durationSec);
  const [maxDriftMs, setMaxDriftMs] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const master = masterRef.current;
      if (master) {
        setTime(master.currentTime);
        let worst = 0;
        for (const tile of tileRefs.current.values()) {
          if (tile.readyState < 2) continue;
          const drift = tile.currentTime - master.currentTime;
          worst = Math.max(worst, Math.abs(drift));
          if (Math.abs(drift) > DRIFT_THRESHOLD) {
            tile.currentTime = master.currentTime;
            if (!master.paused && tile.paused) tile.play().catch(() => {});
          }
        }
        setMaxDriftMs(Math.round(worst * 1000));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const eachTile = (fn: (v: HTMLVideoElement) => void) => {
    tileRefs.current.forEach(fn);
  };

  const togglePlay = () => {
    const master = masterRef.current;
    if (!master) return;
    if (master.paused) {
      master.play().catch(() => {});
      eachTile((t) => t.play().catch(() => {}));
      setPlaying(true);
    } else {
      master.pause();
      eachTile((t) => t.pause());
      setPlaying(false);
    }
  };

  const seek = (t: number) => {
    const master = masterRef.current;
    if (!master) return;
    master.currentTime = t;
    eachTile((tile) => (tile.currentTime = t));
  };

  return (
    <div className="player-shell">
      <div className="stitched">
        <video
          ref={masterRef}
          src={plate.renditions.stitchedPreview}
          muted
          loop
          playsInline
          preload="auto"
          onClick={togglePlay}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setDuration(v.duration);
            // Browsers won't paint the first frame of a paused video until a
            // seek forces a decode — without this the player renders black
            // until the user presses play.
            if (v.paused && v.currentTime === 0) v.currentTime = 0.001;
          }}
        />
      </div>

      <div className="player-controls">
        <button className="play-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? (
            <svg width="13" height="14" viewBox="0 0 13 14" fill="currentColor">
              <rect width="4.5" height="14" />
              <rect x="8.5" width="4.5" height="14" />
            </svg>
          ) : (
            <svg width="13" height="14" viewBox="0 0 13 14" fill="currentColor">
              <path d="M0 0L13 7L0 14Z" />
            </svg>
          )}
        </button>
        <span className="mono-md">{fmt(time)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Scrub"
        />
        <span className="mono-md dim">{fmt(duration)}</span>
        <div className="sync-readout mono">
          <span>
            Sync <span className={maxDriftMs <= 50 ? "ok" : ""}>{maxDriftMs}ms</span>
          </span>
          <span>9-cam lock</span>
        </div>
      </div>

      <div className="nine-grid">
        {GRID_ORDER.map((id) => (
          <div className="cell" key={id}>
            <video
              ref={(el) => {
                if (el) tileRefs.current.set(id, el);
                else tileRefs.current.delete(id);
              }}
              src={plate.renditions.cameraPreviews[id]}
              muted
              loop
              playsInline
              preload="auto"
              onClick={togglePlay}
            />
            <span className="cam-tag mono">
              {id} · {CAMERA_POSITIONS[id]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
