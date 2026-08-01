import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  canonicalWebHostname,
  hostnameFromHost,
  isComingSoonHostname,
} from "@/lib/siteHosts";

export function middleware(request: NextRequest) {
  const hostname = hostnameFromHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
  const canonicalHostname = canonicalWebHostname(hostname);

  if (canonicalHostname) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.protocol = "https";
    redirectUrl.hostname = canonicalHostname;
    redirectUrl.port = "";
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (
    isComingSoonHostname(hostname) &&
    request.nextUrl.pathname !== "/coming-soon"
  ) {
    return NextResponse.rewrite(new URL("/coming-soon", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
