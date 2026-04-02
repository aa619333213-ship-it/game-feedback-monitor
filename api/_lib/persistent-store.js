const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const LOCAL_STORE_PATH = path.join(ROOT, "data", "store.json");
const SEED_STORE_PATH = path.join(ROOT, "data", "store.seed.json");
const STORE_BLOB_PATH = "game-feedback-monitor/store.json";

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

async function readStoreFromBlob() {
  if (!hasBlobStorage()) return null;
  const blobs = await listBlobCandidates();
  if (!blobs.length) return null;
  const response = await fetch(blobs[0].url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch persisted blob store: ${response.status}`);
  }
  return response.json();
}

async function writeStoreToBlob(value) {
  const { del, put } = require("@vercel/blob");
  const blobs = await listBlobCandidates();
  if (blobs.length) {
    await del(blobs.map((item) => item.url));
  }
  await put(STORE_BLOB_PATH, JSON.stringify(value, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
  });
}

async function seedBlobStoreIfNeeded() {
  if (!hasBlobStorage()) return null;
  const existing = await readStoreFromBlob();
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
