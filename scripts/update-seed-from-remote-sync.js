const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SEED_PATH = path.join(ROOT, "data", "store.seed.json");
const GAMES_PATH = path.join(ROOT, "data", "games.json");
const SYNC_URL = process.env.GFM_SYNC_URL || "https://shilongradar.fun/api/admin/sync";
const DASHBOARD_URL = process.env.GFM_DASHBOARD_URL || "https://shilongradar.fun/api/dashboard";
const MIN_SYNC_MINUTES = Math.max(0, Number(process.env.GFM_MIN_SYNC_MINUTES || 60));
const SYNC_MODE = String(process.env.GFM_SYNC_MODE || "light").toLowerCase() === "full" ? "full" : "light";

function toRawPost(post) {
  const originalTitle = post.originalTitle || post.title || "";
  return {
    external_id: post.id,
    parent_id: post.parentId || null,
    platform: "reddit",
    subreddit: post.subreddit || "RiseofKingdoms",
    post_type: post.postType || "submission",
    title: originalTitle,
    body: post.body || "",
    author_name: post.author || "",
    score: Number(post.score || 0),
    comments_count: Number(post.commentsCount || 0),
    post_url: post.url || "",
    created_at_source: post.createdAt,
    combined_text: `${originalTitle} ${post.body || ""}`.trim(),
  };
}

function toStore(dataset) {
  return {
    raw_posts: Array.isArray(dataset.posts) ? dataset.posts.map(toRawPost) : [],
    analyzed_feedback: [],
    precomputed_dataset: dataset,
    meta: {
      lastSyncAt: dataset.overview?.lastSyncAt || new Date().toISOString(),
      gameKey: dataset.overview?.gameKey || "rise-of-kingdoms",
      game: dataset.overview?.game || "Rise of Kingdoms",
    },
    risk_daily_snapshot: [],
    review_labels: Array.isArray(dataset.reviewActions) ? dataset.reviewActions : [],
    alerts: Array.isArray(dataset.alerts) ? dataset.alerts : [],
    rule_config: dataset.rules || null,
  };
}

async function readGames() {
  try {
    const parsed = JSON.parse(await fs.readFile(GAMES_PATH, "utf8"));
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.filter((game) => game && game.key && !game.placeholder);
    }
  } catch {}

  return [{ key: "rise-of-kingdoms", name: "Rise of Kingdoms" }];
}

async function readExistingSeed() {
  try {
    return JSON.parse(await fs.readFile(SEED_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function fetchDataset(gameKey) {
  const url = new URL(SYNC_URL);
  url.searchParams.set("ts", String(Date.now()));
  url.searchParams.set("mode", SYNC_MODE);
  url.searchParams.set("game", gameKey);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
      "User-Agent": "GameFeedbackMonitorSeedSync/1.0",
    },
    signal: AbortSignal.timeout(240000),
  });

  if (!response.ok) {
    throw new Error(`Remote sync failed: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || !payload.ok || !payload.dataset) {
    throw new Error("Remote sync returned invalid payload");
  }

  return payload.dataset;
}

async function fetchLatestOverview() {
  const url = new URL(DASHBOARD_URL);
  url.searchParams.set("ts", String(Date.now()));
  url.searchParams.set("game", "rise-of-kingdoms");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
      "User-Agent": "GameFeedbackMonitorSeedSync/1.0",
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`Dashboard read failed: ${response.status}`);
  }

  const payload = await response.json();
  return payload?.overview || null;
}

async function shouldSkipScheduledSync() {
  const overview = await fetchLatestOverview();
  const lastSyncAt = overview?.lastSyncAt ? new Date(overview.lastSyncAt) : null;
  if (!lastSyncAt || Number.isNaN(lastSyncAt.getTime())) {
    return { skip: false, lastSyncAt: null, ageMinutes: null };
  }

  const ageMinutes = (Date.now() - lastSyncAt.getTime()) / (60 * 1000);
  if (ageMinutes < MIN_SYNC_MINUTES) {
    return { skip: true, lastSyncAt: lastSyncAt.toISOString(), ageMinutes };
  }

  return { skip: false, lastSyncAt: lastSyncAt.toISOString(), ageMinutes };
}

async function main() {
  const scheduleGate = SYNC_MODE === "full" ? { skip: false, lastSyncAt: null, ageMinutes: null } : await shouldSkipScheduledSync();
  if (scheduleGate.skip) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: `Last sync was ${scheduleGate.ageMinutes.toFixed(1)} minutes ago; minimum interval is ${MIN_SYNC_MINUTES} minutes.`,
          lastSyncAt: scheduleGate.lastSyncAt,
          minSyncMinutes: MIN_SYNC_MINUTES,
          mode: SYNC_MODE,
        },
        null,
        2
      )
    );
    return;
  }

  const games = await readGames();
  const existingSeed = await readExistingSeed();
  const gameStores = {
    ...(existingSeed.games && typeof existingSeed.games === "object" ? existingSeed.games : {}),
  };
  const syncedGames = [];

  for (const game of games) {
    const dataset = await fetchDataset(game.key);
    gameStores[game.key] = toStore(dataset);
    syncedGames.push({
      gameKey: game.key,
      syncedAt: dataset.overview?.lastSyncAt || null,
      ingested: Array.isArray(dataset.posts) ? dataset.posts.length : 0,
    });
  }

  const defaultStore = gameStores["rise-of-kingdoms"] || gameStores[games[0]?.key] || {};
  const store = {
    ...existingSeed,
    ...defaultStore,
    games: gameStores,
    rule_config: defaultStore.rule_config || existingSeed.rule_config || null,
    review_labels: defaultStore.review_labels || existingSeed.review_labels || [],
  };

  await fs.writeFile(SEED_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        syncedGames,
        syncedAt: syncedGames[0]?.syncedAt || null,
        ingested: syncedGames.reduce((sum, item) => sum + item.ingested, 0),
        seedPath: SEED_PATH,
        source: SYNC_URL,
        minSyncMinutes: MIN_SYNC_MINUTES,
        mode: SYNC_MODE,
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
