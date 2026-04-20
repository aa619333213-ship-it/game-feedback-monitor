const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const LOCAL_STORE_PATH = path.join(ROOT, "data", "store.json");
const SEED_STORE_PATH = path.join(ROOT, "data", "store.seed.json");
const STORE_BLOB_PATH = "game-feedback-monitor/store.json";
const REMOTE_SEED_CONTENTS_URL =
  "https://api.github.com/repos/aa619333213-ship-it/game-feedback-monitor/contents/data/store.seed.json?ref=monitor-data";
const REMOTE_SEED_URL =
  "https://raw.githubusercontent.com/aa619333213-ship-it/game-feedback-monitor/monitor-data/data/store.seed.json";

function setPersistentStoreMeta(meta) {
  globalThis.__GFM_PERSISTENT_STORE_META = meta;
}

function getLastPersistentStoreMeta() {
  return (
    globalThis.__GFM_PERSISTENT_STORE_META || {
      code: "unknown",
      label: "Unknown store source",
      detail: "",
    }
  );
}

function isBlobUnavailableError(error) {
  const message = String(error?.message || error || "");
  return /blob/i.test(message) && /(suspended|401|403|404|forbidden|unauthorized|not found)/i.test(message);
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

function hasBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getRemoteSeedCache() {
  if (!globalThis.__GFM_REMOTE_SEED_CACHE) {
    globalThis.__GFM_REMOTE_SEED_CACHE = {
      value: null,
      at: 0,
    };
  }

  return globalThis.__GFM_REMOTE_SEED_CACHE;
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
    if (isBlobUnavailableError(error)) {
      console.warn("Blob store unavailable, falling back to seed-backed storage.");
      return null;
    }
    console.error("Failed to list persisted blob store", error);
    return null;
  }
  if (!blobs.length) return null;

  for (const blob of blobs) {
    const value = await fetchBlobJson(blob);
    if (value) {
      setPersistentStoreMeta({
        code: "blob",
        label: "Vercel Blob persistent store",
        detail: "Read from deployed Blob storage.",
      });
      return value;
    }
  }

  return null;
}

async function fetchRemoteSeedFromContentsApi() {
  const response = await fetch(`${REMOTE_SEED_CONTENTS_URL}&ts=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
    headers: {
      "User-Agent": "GameFeedbackMonitor/1.0",
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch remote seed contents: ${response.status}`);
  }

  const payload = await response.json();
  const content = String(payload?.content || "").replace(/\s+/g, "");
  if (!content) {
    throw new Error("Remote seed contents payload did not include file content");
  }

  return JSON.parse(Buffer.from(content, "base64").toString("utf8"));
}

async function fetchRemoteSeedFromRaw() {
  const response = await fetch(`${REMOTE_SEED_URL}?ts=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch remote seed raw file: ${response.status}`);
  }

  return response.json();
}

async function writeStoreToBlob(value) {
  const { del, put } = require("@vercel/blob");
  try {
    const blobs = await listBlobCandidates();
    if (blobs.length) {
      await del(blobs.map((item) => item.url));
    }
    await put(STORE_BLOB_PATH, JSON.stringify(value, null, 2), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
    });
  } catch (error) {
    if (isBlobUnavailableError(error)) {
      console.warn("Blob store unavailable during write, falling back to non-blob persistence.");
      return false;
    }
    throw error;
  }

  return true;
}

async function seedBlobStoreIfNeeded() {
  if (!hasBlobStorage()) return null;
  let existing = null;
  try {
    existing = await readStoreFromBlob();
  } catch (error) {
    if (isBlobUnavailableError(error)) {
      console.warn("Blob store unavailable during seed check, falling back to seed-backed storage.");
      return null;
    }
    console.error("Failed to read persisted blob store before seeding", error);
  }
  if (existing) return existing;
  try {
    const seed = await readJsonFile(SEED_STORE_PATH);
    const wrote = await writeStoreToBlob(seed);
    if (!wrote) return null;
    setPersistentStoreMeta({
      code: "blob-seeded-from-local",
      label: "Vercel Blob seeded from local snapshot",
      detail: "Blob storage was empty, so local seed data was uploaded first.",
    });
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
    const cache = getRemoteSeedCache();
    if (cache.value && Date.now() - cache.at < 5 * 60 * 1000) {
      setPersistentStoreMeta({
        code: "remote-seed-cache",
        label: "Remote seed cache",
        detail: "Used cached remote seed data in the Vercel runtime.",
      });
      return cache.value;
    }

    try {
      const remoteSeed = await fetchRemoteSeedFromContentsApi();
      cache.value = remoteSeed;
      cache.at = Date.now();
      setPersistentStoreMeta({
        code: "remote-seed-contents",
        label: "GitHub seed snapshot",
        detail: "Loaded seed data through the GitHub contents API.",
      });
      return remoteSeed;
    } catch {}

    try {
      const remoteSeed = await fetchRemoteSeedFromRaw();
      cache.value = remoteSeed;
      cache.at = Date.now();
      setPersistentStoreMeta({
        code: "remote-seed-raw",
        label: "GitHub raw seed snapshot",
        detail: "Loaded seed data from the raw GitHub file URL.",
      });
      return remoteSeed;
    } catch {}
  }

  try {
    const localStore = await readJsonFile(LOCAL_STORE_PATH);
    setPersistentStoreMeta({
      code: "local-file",
      label: "Local store.json",
      detail: "Loaded persisted data from the local workspace file.",
    });
    return localStore;
  } catch {}

  try {
    const seedStore = await readJsonFile(SEED_STORE_PATH);
    setPersistentStoreMeta({
      code: "local-seed",
      label: "Local seed snapshot",
      detail: "Loaded fallback seed data from the local workspace.",
    });
    return seedStore;
  } catch {}

  setPersistentStoreMeta({
    code: "none",
    label: "No persisted store",
    detail: "No readable persistent store was available.",
  });
  return null;
}

async function writePersistentStore(value) {
  if (hasBlobStorage()) {
    const wrote = await writeStoreToBlob(value);
    if (wrote) {
      setPersistentStoreMeta({
        code: "blob",
        label: "Vercel Blob persistent store",
        detail: "Latest write completed in Blob storage.",
      });
      return { provider: "blob" };
    }
  }

  if (!isVercelRuntime()) {
    await writeJsonFile(LOCAL_STORE_PATH, value);
    setPersistentStoreMeta({
      code: "local-file",
      label: "Local store.json",
      detail: "Latest write completed in the local workspace file.",
    });
    return { provider: "file" };
  }

  setPersistentStoreMeta({
    code: "memory",
    label: "Runtime memory only",
    detail: "Running without durable persistence in this environment.",
  });
  return { provider: "memory" };
}

module.exports = {
  LOCAL_STORE_PATH,
  SEED_STORE_PATH,
  STORE_BLOB_PATH,
  getLastPersistentStoreMeta,
  hasBlobStorage,
  readPersistentStore,
  writePersistentStore,
};
