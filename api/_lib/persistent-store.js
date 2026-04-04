const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const LOCAL_STORE_PATH = path.join(ROOT, "data", "store.json");
const SEED_STORE_PATH = path.join(ROOT, "data", "store.seed.json");
const STORE_BLOB_PATH = "game-feedback-monitor/store.json";
const REMOTE_SEED_URL =
  "https://raw.githubusercontent.com/aa619333213-ship-it/game-feedback-monitor/main/data/store.seed.json";

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

function hasBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listBlobCandidates() {
  const { list } = require("@vercel/blob");
  const response = await list({ prefix: STORE_BLOB_PATH, limit: 1000 });
  return (response?.blobs || [])
    .filter((item) => item.pathname === STORE_BLOB_PATH || String(item.pathname || "").startsWith(STORE_BLOB_PATH))
    .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

async function fetchBlobJson(blob) {
  const targets = [blob?.downloadUrl, blob?.url].filter(Boolean);

  for (const target of targets) {
    try {
      const response = await fetch(target, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
        },
      });

      if (response.ok) {
        return response.json();
      }

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        continue;
      }

      throw new Error(`Failed to fetch persisted blob store: ${response.status}`);
    } catch (error) {
      if (/404|403|401/.test(String(error?.message || ""))) {
        continue;
      }
      throw error;
    }
  }

  return null;
}

async function readStoreFromBlob() {
  if (!hasBlobStorage()) return null;
  let blobs = [];
  try {
    blobs = await listBlobCandidates();
  } catch (error) {
    console.error("Failed to list persisted blob store", error);
    return null;
  }
  if (!blobs.length) return null;

  for (const blob of blobs) {
    const value = await fetchBlobJson(blob);
    if (value) return value;
  }

  return null;
}

async function writeStoreToBlob(value) {
  const { del, put } = require("@vercel/blob");
  const blobs = await listBlobCandidates();
  if (blobs.length) {
    await del(blobs.map((item) => item.url));
  }
  await put(STORE_BLOB_PATH, JSON.stringify(value, null, 2), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
  });
}

async function seedBlobStoreIfNeeded() {
  if (!hasBlobStorage()) return null;
  let existing = null;
  try {
    existing = await readStoreFromBlob();
  } catch (error) {
    console.error("Failed to read persisted blob store before seeding", error);
  }
  if (existing) return existing;
  try {
    const seed = await readJsonFile(SEED_STORE_PATH);
    await writeStoreToBlob(seed);
    return seed;
  } catch {
    return null;
  }
}

async function readPersistentStore() {
  if (hasBlobStorage()) {
    const blobStore = await seedBlobStoreIfNeeded();
    if (blobStore) return blobStore;
  }

  if (isVercelRuntime()) {
    try {
      const response = await fetch(`${REMOTE_SEED_URL}?ts=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return response.json();
      }
    } catch {}
  }

  try {
    return await readJsonFile(LOCAL_STORE_PATH);
  } catch {}

  try {
    return await readJsonFile(SEED_STORE_PATH);
  } catch {}

  return null;
}

async function writePersistentStore(value) {
  if (hasBlobStorage()) {
    await writeStoreToBlob(value);
    return { provider: "blob" };
  }

  if (!isVercelRuntime()) {
    await writeJsonFile(LOCAL_STORE_PATH, value);
    return { provider: "file" };
  }

  return { provider: "memory" };
}

module.exports = {
  LOCAL_STORE_PATH,
  SEED_STORE_PATH,
  STORE_BLOB_PATH,
  hasBlobStorage,
  readPersistentStore,
  writePersistentStore,
};
