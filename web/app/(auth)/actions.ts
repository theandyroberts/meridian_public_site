"use server";

import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getSiteUrl } from "@/lib/auth/siteUrl";
import { createClient } from "@/lib/supabase/server";

function formString(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function messagePath(
  pathname: string,
  kind: "error" | "message",
  message: string,
): string {
  const params = new URLSearchParams({ [kind]: message });
  return `${pathname}?${params.toString()}`;
}

function loginMessagePath(
  kind: "error" | "message",
  message: string,
  next: string,
  mode?: "signin" | "signup",
): string {
  const params = new URLSearchParams({ [kind]: message, next });
  if (mode === "signup") params.set("mode", "signup");
  return `/login?${params.toString()}`;
}

export async function signIn(formData: FormData) {
  const email = formString(formData, "email").toLowerCase();
  const password = formString(formData, "password");
  const next = safeRedirectPath(formString(formData, "next"));

  if (!email || !password) {
    redirect(
      loginMessagePath(
        "error",
        "Enter your email and password.",
        next,
      ),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(
      loginMessagePath(
        "error",
        "We could not sign you in with those credentials.",
        next,
      ),
    );
  }

  redirect(next);
}

export async function signUp(formData: FormData) {
  const displayName = formString(formData, "displayName");
  const email = formString(formData, "email").toLowerCase();
  const password = formString(formData, "password");
  const passwordConfirmation = formString(
    formData,
    "passwordConfirmation",
  );
  const next = safeRedirectPath(formString(formData, "next"));

  if (!displayName || !email) {
    redirect(
      loginMessagePath(
        "error",
        "Enter your name and email address.",
        next,
        "signup",
      ),
    );
  }

  if (password.length < 12) {
    redirect(
      loginMessagePath(
        "error",
        "Use at least 12 characters for your password.",
        next,
        "signup",
      ),
    );
  }

  if (password !== passwordConfirmation) {
    redirect(
      loginMessagePath(
        "error",
        "The password confirmation does not match.",
        next,
        "signup",
      ),
    );
  }

  const supabase = await createClient();
  const siteUrl = await getSiteUrl();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    redirect(
      loginMessagePath(
        "error",
        "We could not create the account. Check the details and try again.",
        next,
        "signup",
      ),
    );
  }

  if (data.session) redirect(next);

  redirect(
    loginMessagePath(
      "message",
      "Check your email to confirm your account, then return here to sign in.",
      next,
    ),
  );
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeRedirectPath(formString(formData, "next"));
  const supabase = await createClient();
  const siteUrl = await getSiteUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });

  if (error || !data.url) {
    redirect(
      loginMessagePath(
        "error",
        "Google sign-in is not available yet. Continue with email instead.",
        next,
      ),
    );
  }

  redirect(data.url);
}

export async function requestPasswordReset(formData: FormData) {
  const email = formString(formData, "email").toLowerCase();

  if (!email) {
    redirect(
      messagePath(
        "/forgot-password",
        "error",
        "Enter the email address for your account.",
      ),
    );
  }

  const supabase = await createClient();
  const siteUrl = await getSiteUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    redirect(
      messagePath(
        "/forgot-password",
        "error",
        "The recovery email could not be sent. Please try again.",
      ),
    );
  }

  // Do not disclose whether an account exists for this email address.
  redirect(
    messagePath(
      "/forgot-password",
      "message",
      "If an account exists, a recovery link is on its way.",
    ),
  );
}

export async function updatePassword(formData: FormData) {
  const password = formString(formData, "password");
  const confirmation = formString(formData, "passwordConfirmation");

  if (password.length < 12) {
    redirect(
      messagePath(
        "/reset-password",
        "error",
        "Use at least 12 characters for your new password.",
      ),
    );
  }

  if (password !== confirmation) {
    redirect(
      messagePath(
        "/reset-password",
        "error",
        "The password confirmation does not match.",
      ),
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      messagePath(
        "/forgot-password",
        "error",
        "That recovery session is no longer valid. Request a new link.",
      ),
    );
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(
      messagePath(
        "/reset-password",
        "error",
        "The password could not be updated. Request a new recovery link.",
      ),
    );
  }

  redirect(
    messagePath("/login", "message", "Password updated. You can now sign in."),
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
