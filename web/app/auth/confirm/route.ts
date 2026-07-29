import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && OTP_TYPES.has(value as EmailOtpType);
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const next = safeRedirectPath(
    requestedNext ?? (type === "recovery" ? "/reset-password" : "/projects"),
  );

  if (tokenHash && isEmailOtpType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "error",
    "That authentication link is invalid or has expired.",
  );
  return NextResponse.redirect(loginUrl);
}
