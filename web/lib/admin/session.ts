import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifySessionCookie } from "./sessionCore";

export { ADMIN_COOKIE, createSessionCookie, verifySessionCookie, checkPassword } from "./sessionCore";

/** Call at the top of every admin page/action. */
export async function requireAdmin(): Promise<void> {
  const jar = await cookies();
  const v = jar.get(ADMIN_COOKIE)?.value;
  if (!v || !verifySessionCookie(v)) redirect("/admin/login");
}
