import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outputUrl = new URL("../shared/src/database.types.ts", import.meta.url);
const projectDirectory = fileURLToPath(new URL("..", import.meta.url));

const generatedTypes = execFileSync(
  "supabase",
  ["gen", "types", "typescript", "--local", "--schema", "public"],
  {
    cwd: projectDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);

writeFileSync(outputUrl, `${generatedTypes.trimEnd()}\n`);
console.log(`Generated ${fileURLToPath(outputUrl)}`);
