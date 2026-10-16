"use client";

import { useEffect, useRef } from "react";

export function ComingSoonGlobe() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let x = 0, y = 0, targetX = 0, targetY = 0;
    const draw = () => {
      x += (targetX - x) * 0.075;
      y += (targetY - y) * 0.075;
      element.style.setProperty("--globe-yaw", `${x.toFixed(3)}deg`);
      element.style.setProperty("--globe-pitch", `${y.toFixed(3)}deg`);
      frame = Math.abs(targetX - x) + Math.abs(targetY - y) > 0.01
        ? requestAnimationFrame(draw) : 0;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const move = (event: PointerEvent) => {
      if (reducedMotion.matches || !finePointer.matches || document.hidden) return;
      targetX = (event.clientX / window.innerWidth - 0.5) * 24;
      targetY = (0.5 - event.clientY / window.innerHeight) * 14;
      schedule();
    };
    const reset = () => {
      cancelAnimationFrame(frame); frame = 0;
      x = y = targetX = targetY = 0;
      element.style.setProperty("--globe-yaw", "0deg");
      element.style.setProperty("--globe-pitch", "0deg");
      element.dataset.paused = String(document.hidden || reducedMotion.matches);
    };
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return;
      targetX = targetY = 0;
      if (!reducedMotion.matches && !document.hidden) schedule();
    };
    reset();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerout", leave, { passive: true });
    document.addEventListener("visibilitychange", reset);
    reducedMotion.addEventListener("change", reset);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", leave);
      document.removeEventListener("visibilitychange", reset);
      reducedMotion.removeEventListener("change", reset);
    };
  }, []);

  return (
    <div ref={host} className="coming-soon-orbit" aria-hidden="true">
      <div className="coming-soon-globe-follow">
        <img className="coming-soon-globe-drift" src="/branding/plate-lab-globe-lines.svg" width={180} height={124} alt="" />
      </div>
      <img className="coming-soon-fixed-plate" src="/branding/plate-lab-globe-plate.svg" width={180} height={124} alt="" />
    </div>
  );
}
