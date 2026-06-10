import fs from "node:fs";
import path from "node:path";
import { DROPS_DIR } from "./paths.js";
import { ingestDrop } from "./ingest.js";

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
    default:
      console.error("usage: cli.ts <ingest <dir> | ingest-all>");
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`ingest failed: ${err.message}`);
  process.exit(1);
});
