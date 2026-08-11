import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getSiteUrl } from "@/lib/auth/siteUrl";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));
  const siteUrl = await getSiteUrl();

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, siteUrl));
  }

  const loginUrl = new URL("/login", siteUrl);
  loginUrl.searchParams.set(
    "error",
    "That authentication link is invalid or has expired.",
  );
  return NextResponse.redirect(loginUrl);
}
