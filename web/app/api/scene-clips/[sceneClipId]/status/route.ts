import { NextResponse } from "next/server";
import { parseSceneClipStatusUpdate } from "@/lib/sceneClipWorkspace";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sceneClipId: string }> },
) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) {
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",")[0]
      ?.trim();
    const expectedHost = forwardedHost || request.headers.get("host") || requestUrl.host;
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      // Invalid origins never represent a same-origin browser request.
    }
    if (originHost !== expectedHost) {
      return NextResponse.json({ error: "Cross-origin update denied." }, { status: 403 });
    }
  }

  const { sceneClipId } = await params;
  if (!UUID_PATTERN.test(sceneClipId)) {
    return NextResponse.json({ error: "Invalid scene clip." }, { status: 400 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const update = parseSceneClipStatusUpdate(input);
  if (!update) {
    return NextResponse.json(
      { error: "A valid clip status and record version are required." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to update scene candidates." }, { status: 401 });
  }

  const nextVersion = update.expectedVersion + 1;
  const { data, error } = await supabase
    .from("scene_clips")
    .update({ status: update.status, version: nextVersion })
    .eq("id", sceneClipId)
    .eq("version", update.expectedVersion)
    .select("status, version")
    .maybeSingle();

  if (error) {
    console.warn(`Scene candidate status update failed: ${error.message}`);
    return NextResponse.json(
      { error: "This candidate could not be updated. Confirm that you can edit the project and retry." },
      { status: 403 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "This candidate changed in another session. Refresh the workspace and retry." },
      { status: 409 },
    );
  }

  return NextResponse.json(data, {
    headers: { "cache-control": "private, no-store" },
  });
}
