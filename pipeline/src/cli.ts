import fs from "node:fs";
import path from "node:path";
import { DROPS_DIR } from "./paths.js";
import { ingestDrop } from "./ingest.js";
import { audit } from "./audit.js";
import { preflightDrop, printPreflight } from "./preflight.js";

const [, , command, arg] = process.argv;
const callerDir = process.env.INIT_CWD || process.cwd();
const resolveArg = (value: string) => path.resolve(callerDir, value);

async function main() {
  switch (command) {
    case "ingest": {
      if (!arg) throw new Error("usage: cli.ts ingest <drop-dir>");
      const plate = await ingestDrop(resolveArg(arg));
      console.log(`✓ ${plate.sku}  ${plate.title}  $${plate.pricing.totalUsd}`);
      break;
    }
    case "ingest-all": {
      const drops = fs
        .readdirSync(DROPS_DIR)
        .filter((d) => fs.statSync(path.join(DROPS_DIR, d)).isDirectory())
        .sort();
      for (const d of drops) {
        const plate = await ingestDrop(path.join(DROPS_DIR, d));
        console.log(`✓ ${plate.sku}  ${plate.title}  $${plate.pricing.totalUsd}`);
      }
      break;
    }
    case "preflight": {
      if (!arg) throw new Error("usage: cli.ts preflight <drop-dir>");
      const result = await preflightDrop(resolveArg(arg));
      printPreflight(result);
      if (!result.ready) process.exitCode = 1;
      break;
    }
    case "preflight-all": {
      const root = arg ? resolveArg(arg) : DROPS_DIR;
      const drops = fs
        .readdirSync(root)
        .filter((d) => fs.statSync(path.join(root, d)).isDirectory())
        .sort();
      let blocked = 0;
      for (const d of drops) {
        const result = await preflightDrop(path.join(root, d));
        printPreflight(result);
        if (!result.ready) blocked += 1;
      }
      console.log(`\n${drops.length - blocked}/${drops.length} drops ready; ${blocked} blocked`);
      if (blocked) process.exitCode = 1;
      break;
    }
    case "approve":
    case "reject": {
      if (!arg) throw new Error(`usage: cli.ts ${command} <sku> [reason]`);
      const { isValidSku } = await import("@platelab/shared");
      if (!isValidSku(arg)) throw new Error(`invalid SKU (check digit): ${arg}`);
      const { loadPlate, publishPlate: upsert } = await import("./stages/publish.js");
      const plate = await loadPlate(arg);
      if (!plate) throw new Error(`unknown SKU: ${arg}`);
      if (command === "approve") {
        await upsert({ ...plate, status: "live" });
        audit("cli.approve", { sku: arg });
        console.log(`✓ ${arg} → live`);
      } else {
        const { removePlate } = await import("./stages/publish.js");
        const reason = process.argv.slice(4).join(" ") || "rejected via cli";
        await removePlate(arg, reason);
        audit("cli.reject", { sku: arg, reason });
        console.log(`✗ ${arg} removed (SKU retired, never reused)`);
      }
      break;
    }
    default:
      console.error("usage: cli.ts <preflight <dir> | preflight-all [root] | ingest <dir> | ingest-all | approve <sku> | reject <sku> [reason]>");
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`pipeline failed: ${err.message}`);
  process.exit(1);
});
