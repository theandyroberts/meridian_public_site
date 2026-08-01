import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { hostnameFromHost, isComingSoonHostname } from "@/lib/siteHosts";

export async function middleware(request: NextRequest) {
  const hostname = hostnameFromHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );

  if (
    isComingSoonHostname(hostname) &&
    request.nextUrl.pathname !== "/coming-soon"
  ) {
    return NextResponse.rewrite(new URL("/coming-soon", request.url));
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
