import { NextResponse } from "next/server";
import { parseSceneClipSelectionUpdate } from "@/lib/sceneClipSelection";
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
      // Invalid Origin values are never valid browser same-origin requests.
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
  const selection = parseSceneClipSelectionUpdate(input);
  if (!selection) {
    return NextResponse.json(
      { error: "A valid In frame, later Out frame, and record version are required." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to save this selection." }, { status: 401 });
  }

  const nextVersion = selection.expectedVersion + 1;
  const { data, error } = await supabase
    .from("scene_clips")
    .update({
      in_frame: selection.inFrame,
      out_frame: selection.outFrame,
      version: nextVersion,
    })
    .eq("id", sceneClipId)
    .eq("version", selection.expectedVersion)
    .select("in_frame, out_frame, version")
    .maybeSingle();

  if (error) {
    console.warn(`Scene clip selection update failed: ${error.message}`);
    return NextResponse.json(
      { error: "Selection could not be saved." },
      { status: 403 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "This clip changed in another session. Refresh the scene and retry." },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      inFrame: data.in_frame,
      outFrame: data.out_frame,
      version: data.version,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
