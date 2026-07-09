import fs from "node:fs";
import path from "node:path";
import { DROPS_DIR } from "./paths.js";
import { ingestDrop } from "./ingest.js";
import { audit } from "./audit.js";

const [, , command, arg] = process.argv;

async function main() {
  switch (command) {
    case "ingest": {
      if (!arg) throw new Error("usage: cli.ts ingest <drop-dir>");
      const plate = await ingestDrop(path.resolve(arg));
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
    case "approve":
    case "reject": {
      if (!arg) throw new Error(`usage: cli.ts ${command} <sku> [reason]`);
      const { isValidSku } = await import("@platelab/shared");
      if (!isValidSku(arg)) throw new Error(`invalid SKU (check digit): ${arg}`);
      const { loadCatalog, publishPlate: upsert } = await import("./stages/publish.js");
      const catalog = loadCatalog();
      const plate = catalog.plates.find((p) => p.sku === arg);
      if (!plate) throw new Error(`unknown SKU: ${arg}`);
      if (command === "approve") {
        upsert({ ...plate, status: "live" });
        audit("cli.approve", { sku: arg });
        console.log(`✓ ${arg} → live`);
      } else {
        const { removePlate } = await import("./stages/publish.js");
        const reason = process.argv.slice(4).join(" ") || "rejected via cli";
        removePlate(arg, reason);
        audit("cli.reject", { sku: arg, reason });
        console.log(`✗ ${arg} removed (SKU retired, never reused)`);
      }
      break;
    }
    default:
      console.error("usage: cli.ts <ingest <dir> | ingest-all | approve <sku> | reject <sku> [reason]>");
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`ingest failed: ${err.message}`);
  process.exit(1);
});
