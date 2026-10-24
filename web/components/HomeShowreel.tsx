"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "@phosphor-icons/react";
import styles from "./HomeShowreel.module.css";

export function HomeShowreel() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const play = () => {
    const media = video.current;
    if (!media) return;
    media.muted = true;
    if (media.error) media.load();
    void media.play()
      .then(() => setPlaying(!media.paused))
      .catch(() => setPlaying(!media.paused));
  };

  useEffect(() => { play(); }, []);

  const label = playing ? "Pause showreel" : "Play showreel";
  return (
    <section className={styles.showreel} aria-label="Plate Lab showreel">
      <video
        ref={video}
        src="/media/site/mustang-study14-reflections-4k.mp4"
        poster="/media/site/mustang-study14-reflections-poster.jpg"
        width={3840}
        height={2160}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-label="Plate Lab showreel"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        type="button"
        className={styles.playback}
        aria-label={label}
        title={label}
        onClick={() => video.current?.paused ? play() : video.current?.pause()}
      >
        {playing ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
      </button>
    </section>
  );
}
