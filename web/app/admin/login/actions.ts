"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, checkPassword, createSessionCookie } from "@/lib/admin/session";

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) redirect("/admin/login?error=1");
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, createSessionCookie(), {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 7 * 86400,
  });
  redirect("/admin/handoffs");
}
