"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, checkPassword, createSessionCookie } from "@/lib/admin/session";

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) redirect("/admin/login?error=1");
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, createSessionCookie(), {
    httpOnly: true,
    sameSite: "lax",
    // Browsers drop Secure cookies over plain-HTTP IP addresses (no localhost
    // exemption). Until the production domain + TLS exist, the server sets
    // ADMIN_COOKIE_INSECURE=1; remove it the moment HTTPS is live.
    secure: process.env.ADMIN_COOKIE_INSECURE !== "1",
    path: "/",
    maxAge: 7 * 86400,
  });
  redirect("/admin/handoffs");
}
