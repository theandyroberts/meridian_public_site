import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";

const supabaseUrl =
  process.env.TPL_STAGING_SUPABASE_URL ??
  "https://supabase-staging.theplatelab.site";
const anonKey = await secretPrompt("Paste staging anon key: ");
const readline = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const email = (await readline.question("Recipient email: ")).trim();
readline.close();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("A valid recipient email is required");
}

const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    password: `Tpl-Staging-${randomBytes(18).toString("base64url")}!`,
    data: {
      display_name: "TPL Staging Email Test",
    },
  }),
});
const body = await response.text();

if (!response.ok) {
  throw new Error(`Staging signup failed (${response.status}): ${body}`);
}

console.log("Staging signup accepted and confirmation email requested.");
console.log("Check the recipient inbox and Resend email activity.");
console.log("Do not click the confirmation link until the staging web app exists.");

function secretPrompt(prompt) {
  return new Promise((resolve, reject) => {
    let secret = "";
    const input = process.stdin;

    if (!input.isTTY || !process.stdout.isTTY) {
      reject(new Error("An interactive terminal is required"));
      return;
    }

    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();

    const finish = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };

    const onData = (characters) => {
      for (const character of characters) {
        if (character === "\r" || character === "\n") {
          finish();
          resolve(secret.trim());
          return;
        }

        if (character === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }

        if (character === "\u007f") {
          secret = secret.slice(0, -1);
          continue;
        }

        secret += character;
      }
    };

    input.on("data", onData);
  });
}
