import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function run(
  cmd: string,
  args: string[],
  opts: { maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args, {
      maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as Error & { stderr?: string };
    throw new Error(
      `${cmd} ${args.slice(0, 6).join(" ")}… failed: ${e.stderr?.slice(-800) ?? e.message}`,
    );
  }
}

export async function ffprobeJson(file: string): Promise<any> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  return JSON.parse(stdout);
}
