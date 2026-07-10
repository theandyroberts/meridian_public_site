import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ADMIN_COOKIE, verifySessionCookie } from "@/lib/admin/sessionCore";

/**
 * Authenticated file server for stitch review reports.
 *
 * Reports live in web/data/stitch-reports/<run>/ (runtime state, untracked —
 * uploaded by pipeline/stitch/publish-report.sh). They contain UNWATERMARKED
 * preview footage, so every byte goes through the admin-session check: no
 * cookie, no pixels. Supports HTTP Range so the mp4s scrub properly.
 */

const REPORTS_ROOT = path.join(process.cwd(), "data", "stitch-reports");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const jar = await cookies();
  const session = jar.get(ADMIN_COOKIE)?.value;
  if (!session || !verifySessionCookie(session)) {
    return NextResponse.json({ error: "admin session required" }, { status: 401 });
  }

  const { path: parts } = await params;
  const filePath = path.resolve(path.join(REPORTS_ROOT, ...parts));
  if (!filePath.startsWith(path.resolve(REPORTS_ROOT) + path.sep)) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const size = fs.statSync(filePath).size;
  const type = TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
      if (start <= end && start < size) {
        const stream = Readable.toWeb(
          fs.createReadStream(filePath, { start, end }),
        ) as ReadableStream;
        return new Response(stream, {
          status: 206,
          headers: {
            "content-type": type,
            "content-length": String(end - start + 1),
            "content-range": `bytes ${start}-${end}/${size}`,
            "accept-ranges": "bytes",
            "cache-control": "private, no-store",
          },
        });
      }
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    }
  }

  const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": type,
      "content-length": String(size),
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
    },
  });
}
