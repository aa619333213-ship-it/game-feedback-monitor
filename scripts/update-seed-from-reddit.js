const fs = require("node:fs/promises");
const path = require("node:path");
const { buildDataset, forceRefresh } = require("../api/_lib/monitor");

const ROOT = path.resolve(__dirname, "..");
const STORE_PATH = path.join(ROOT, "data", "store.json");
const SEED_PATH = path.join(ROOT, "data", "store.seed.json");

async function main() {
  forceRefresh();
  const dataset = await buildDataset({ force: true });
  const storeText = await fs.readFile(STORE_PATH, "utf8");
  await fs.writeFile(SEED_PATH, `${storeText.trim()}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        syncedAt: dataset.overview.lastSyncAt,
        ingested: dataset.posts.length,
        seedPath: SEED_PATH,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
