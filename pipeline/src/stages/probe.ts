import { ffprobeJson } from "../exec.js";

export interface ProbeResult {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
}

export async function probe(file: string): Promise<ProbeResult> {
  const info = await ffprobeJson(file);
  const video = info.streams?.find((s: any) => s.codec_type === "video");
  if (!video) throw new Error(`${file}: no video stream`);

  const [num, den] = String(video.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = den ? num / den : 0;
  const durationSec = Number(video.duration ?? info.format?.duration ?? 0);

  if (!durationSec || !fps) throw new Error(`${file}: could not read duration/fps`);

  return {
    durationSec,
    fps: Math.round(fps * 100) / 100,
    width: video.width,
    height: video.height,
    codec: video.codec_name,
  };
}
