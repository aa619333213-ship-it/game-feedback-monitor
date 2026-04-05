const fs = require("node:fs/promises");
const path = require("node:path");
const { hasBlobStorage, readPersistentStore, writePersistentStore } = require("./persistent-store");

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCES_PATH = path.join(ROOT, "data", "sources.json");
const STORE_PATH = path.join(ROOT, "data", "store.json");
const REDDIT_USER_AGENT =
  "ShilongRadarBot/1.0 (by /u/aa619333213-ship-it; +https://shilongradar.fun)";

const TOPIC_FOCUS = {
  matchmaking: "\u5339\u914d\u516c\u5e73\u6027\u548c\u5bf9\u5c40\u8d28\u91cf",
  economy: "\u8d44\u6e90\u6295\u5165\u4ea7\u51fa\u548c\u517b\u6210\u56de\u62a5",
  monetization: "\u4ed8\u8d39\u4ef7\u503c\u548c\u4ef7\u683c\u611f\u77e5",
  event: "\u6d3b\u52a8\u8282\u594f\u3001\u5956\u52b1\u548c\u5ba3\u4f20\u9884\u671f",
  progression: "\u6210\u957f\u7ebf\u538b\u529b\u548c\u517b\u6210\u95e8\u69db",
  balance: "\u7248\u672c\u5f3a\u5ea6\u548c\u5e73\u8861\u8282\u594f",
  server: "\u8fde\u63a5\u7a33\u5b9a\u6027\u548c\u9ad8\u5cf0\u65f6\u6bb5\u4f53\u9a8c",
  bug: "\u529f\u80fd\u5f02\u5e38\u548c\u6d41\u7a0b\u5931\u6548",
  "anti-cheat": "\u53cd\u4f5c\u5f0a\u611f\u77e5\u548c\u516c\u5e73\u6027\u4fe1\u4efb",
};

const TOPIC_LABEL_ZH = {
  matchmaking: "\u5339\u914d",
  economy: "\u7ecf\u6d4e",
  monetization: "\u4ed8\u8d39",
  event: "\u6d3b\u52a8",
  progression: "\u8fdb\u5ea6",
  balance: "\u5e73\u8861",
  server: "\u670d\u52a1\u5668",
  bug: "Bug",
  "anti-cheat": "\u53cd\u4f5c\u5f0a",
};

function getState() {
  if (!globalThis.__GFM_VERCEL_STATE) {
    globalThis.__GFM_VERCEL_STATE = {
      rules: null,
      reviewLabels: [],
      store: null,
      cache: {
        raw: null,
        dataset: null,
        rawAt: 0,
        datasetAt: 0,
      },
    };
  }

  return globalThis.__GFM_VERCEL_STATE;
}

function isVolatileVercelRuntime() {
  return Boolean(process.env.VERCEL) && !hasBlobStorage();
}

function createEmptyStore() {
  return {
    raw_posts: [],
    analyzed_feedback: [],
    meta: {
      lastSyncAt: null,
      game: "Rise of Kingdoms",
    },
    risk_daily_snapshot: [],
    review_labels: [],
    alerts: [],
    rule_config: getDefaultRules(),
  };
}

function normalizeStoreShape(store) {
  const base = store && typeof store === "object" ? store : {};
  const rules = base.rule_config && typeof base.rule_config === "object" ? base.rule_config : getDefaultRules();
  return {
    ...createEmptyStore(),
    ...base,
    raw_posts: Array.isArray(base.raw_posts) ? base.raw_posts : [],
    analyzed_feedback: Array.isArray(base.analyzed_feedback) ? base.analyzed_feedback : [],
    risk_daily_snapshot: Array.isArray(base.risk_daily_snapshot) ? base.risk_daily_snapshot : [],
    review_labels: Array.isArray(base.review_labels) ? base.review_labels : [],
    alerts: Array.isArray(base.alerts) ? base.alerts : [],
    meta: {
      ...createEmptyStore().meta,
      ...(base.meta || {}),
    },
    rule_config: {
      ...getDefaultRules(),
      ...rules,
      risk: {
        ...getDefaultRules().risk,
        ...(rules.risk || {}),
      },
      sentiment: {
        ...getDefaultRules().sentiment,
        ...(rules.sentiment || {}),
      },
      taxonomy: Array.isArray(rules.taxonomy) && rules.taxonomy.length ? rules.taxonomy : getDefaultRules().taxonomy,
    },
  };
}

async function getStore() {
  const state = getState();
  if (state.store && !isVolatileVercelRuntime()) {
    return state.store;
  }

  const persisted = await readPersistentStore();
  const normalized = normalizeStoreShape(persisted);
  if (!isVolatileVercelRuntime()) {
    state.store = normalized;
  }
  return normalized;
}

async function saveStore(nextStore) {
  const state = getState();
  state.store = normalizeStoreShape(nextStore);
  await writePersistentStore(state.store);
  return state.store;
}

async function hydrateStateFromStore() {
  const state = getState();
  const store = await getStore();
  state.rules = store.rule_config || getDefaultRules();
  state.reviewLabels = Array.isArray(store.review_labels) ? store.review_labels : [];
  return store;
}

async function readSources() {
  const text = await fs.readFile(SOURCES_PATH, "utf8");
  return JSON.parse(text);
}

function getDefaultRules() {
  return {
    risk: {
      red: ["quit", "delete", "refund", "scam", "cheat"],
      orange: ["nerf", "unbalanced", "lag", "toxic", "impossible"],
      green: ["guide", "help", "best"],
    },
    sentiment: {
      negativePhrases: ["!!!", "FUCK", "SICK"],
      positive: ["love", "thanks", "awesome"],
    },
    taxonomy: [
      { key: "matchmaking", label: "Matchmaking", aliases: ["queue", "ranked", "matchmaking", "premade", "mmr", "match"] },
      { key: "economy", label: "Economy", aliases: ["resource", "gold", "price", "economy", "reward", "currency"] },
      { key: "monetization", label: "Monetization", aliases: ["gacha", "banner", "shop", "spend", "pity", "monetization", "cash"] },
      { key: "event", label: "Event", aliases: ["event", "anniversary", "limited", "calendar", "festival"] },
      { key: "progression", label: "Progression", aliases: ["grind", "xp", "level", "progression", "farm", "upgrade"] },
      { key: "balance", label: "Balance", aliases: ["balance", "meta", "nerf", "buff", "underpowered"] },
      { key: "server", label: "Server", aliases: ["lag", "disconnect", "server", "ping", "rubber band", "latency"] },
      { key: "bug", label: "Bug", aliases: ["bug", "crash", "broken", "stuck", "glitch", "issue"] },
      { key: "anti-cheat", label: "Anti-Cheat", aliases: ["hack", "cheat", "bot", "aimbot", "exploit"] },
    ],
  };
}

function getRules() {
  const state = getState();
  if (!state.rules) {
    state.rules = getDefaultRules();
  }

  return state.rules;
}

async function loadRules() {
  const store = await hydrateStateFromStore();
  return store.rule_config || getDefaultRules();
}

function sanitizeText(value) {
  if (value == null) return "";
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\u2028|\u2029/g, " ")
    .replace(/[^\t\n\r\u0020-\u007E]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDirectTopicText(raw) {
  if (!raw) return "";
  if (raw.post_type === "comment") {
    return sanitizeText(raw.body);
  }

  return sanitizeText(`${raw.title || ""} ${raw.body || ""}`);
}

function testTopicAliasMatch(topicKey, alias, text) {
  if (!alias || !text) return false;
  const normalizedAlias = alias.toLowerCase();
  const lower = text.toLowerCase();

  if (normalizedAlias === "op") return false;

  if (topicKey === "bug" && normalizedAlias === "issue") {
    const issuePattern =
      /((?<![a-z0-9])(issue|issues)(?![a-z0-9])\s+(with|when|after|on|in|causing|caused|stops?|stopped|fails?|failed|won't|cant|can't|cannot|bugged))|((login|server|march|forge|weapon|screen|quest|peacekeeping|client|ui|account)\s+(issue|issues))/i;
    return issuePattern.test(lower);
  }

  const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(normalizedAlias)}(?![a-z0-9])`, "i");
  return pattern.test(lower);
}

function getTopicMatch(text, rules = getRules()) {
  for (const topic of rules.taxonomy || []) {
    for (const alias of topic.aliases || []) {
      const normalizedAlias = String(alias || "").trim().toLowerCase();
      if (!normalizedAlias) continue;
      if (testTopicAliasMatch(topic.key, normalizedAlias, text)) {
        return { key: topic.key, alias: normalizedAlias };
      }
    }
  }

  return null;
}

function getSentiment(text, rules = getRules()) {
  const source = String(text || "");
  const lower = source.toLowerCase();

  for (const phrase of rules.sentiment?.negativePhrases || []) {
    if (phrase === "!!!" && /!{3,}/.test(source)) return "negative";
    if (phrase !== "!!!") {
      const pattern = new RegExp(`\\b${escapeRegExp(String(phrase))}\\b`);
      if (pattern.test(source)) return "negative";
    }
  }

  for (const word of rules.sentiment?.positive || []) {
    const pattern = new RegExp(`\\b${escapeRegExp(String(word).toLowerCase())}\\b`, "i");
    if (pattern.test(lower)) return "positive";
  }

  return "neutral";
}

function getContentRiskLevel(text, rules = getRules()) {
  const lower = String(text || "").toLowerCase();

  for (const word of rules.risk?.red || []) {
    const pattern = new RegExp(`\\b${escapeRegExp(String(word).toLowerCase())}\\b`, "i");
    if (pattern.test(lower)) return "red";
  }

  for (const word of rules.risk?.orange || []) {
    const pattern = new RegExp(`\\b${escapeRegExp(String(word).toLowerCase())}\\b`, "i");
    if (pattern.test(lower)) return "orange";
  }

  return "green";
}

function getRiskScoreFromLevel(level) {
  if (level === "red") return 90;
  if (level === "orange") return 65;
  return 25;
}

function getRiskPriority(level) {
  if (level === "red") return 3;
  if (level === "orange") return 2;
  return 1;
}

function getRiskDisplayCopy(level) {
  if (level === "red") return "Immediate Intervention Required";
  if (level === "orange") return "Close Observation Needed";
  return "Routine Feedback Collection";
}

function getRiskIntensity(level) {
  if (level === "red") return 1;
  if (level === "orange") return 0.45;
  return 0.08;
}

function getWeatherLevelFromScore(score) {
  if (score > 80) return "green";
  if (score >= 60) return "orange";
  return "red";
}

function getWeatherLabel(level) {
  if (level === "green") return "sunny";
  if (level === "orange") return "cloudy";
  return "rainy";
}

function getWeatherAdvice(level) {
  if (level === "green") return "Routine Monitoring";
  if (level === "orange") return "Close Risk Watch";
  return "Immediate Intervention Required";
}

function getFallbackRawPosts() {
  const now = Date.now();
  const iso = (hoursAgo) => new Date(now - hoursAgo * 60 * 60 * 1000).toISOString();

  return [
    {
      external_id: "t1_seed_event_1",
      parent_id: "t3_seed_event_parent",
      platform: "reddit",
      subreddit: "RiseofKingdoms",
      post_type: "comment",
      title: "Where did kvk originate?",
      body: "Karuak was one of the reasons I quit. The repeating event cycle became exhausting and the reward value felt off.",
      author_name: "Numerous-Key6162",
      score: 3,
      comments_count: 0,
      post_url: "https://www.reddit.com/r/RiseofKingdoms/comments/1s95qb3/where_did_kvk_originate/odocr2c",
      created_at_source: iso(18),
      combined_text: "Where did kvk originate? Karuak was one of the reasons I quit. The repeating event cycle became exhausting and the reward value felt off.",
    },
    {
      external_id: "t3_seed_progression_1",
      parent_id: null,
      platform: "reddit",
      subreddit: "RiseofKingdoms",
      post_type: "submission",
      title: "Concerns over future of power creep",
      body: "I think future commanders may make the game impossible for F2Ps and push progression too hard.",
      author_name: "NoCow3503",
      score: 0,
      comments_count: 10,
      post_url: "https://www.reddit.com/r/RiseofKingdoms/comments/1s951xv/concerns_over_future_of_power_creep/",
      created_at_source: iso(28),
      combined_text: "Concerns over future of power creep I think future commanders may make the game impossible for F2Ps and push progression too hard.",
    },
    {
      external_id: "t3_seed_economy_1",
      parent_id: null,
      platform: "reddit",
      subreddit: "RiseofKingdoms",
      post_type: "submission",
      title: "Indecision led me to this by the end of kvk1, am I cooked??",
      body: "Saving gold heads may be stunting my progress more than helping. The long-term resource value feels unclear.",
      author_name: "Single-Brain7452",
      score: 9,
      comments_count: 27,
      post_url: "https://www.reddit.com/r/RiseofKingdoms/comments/1s9qpif/indecision_led_me_to_this_by_the_end_of_kvk1_am_i/",
      created_at_source: iso(11),
      combined_text: "Indecision led me to this by the end of kvk1, am I cooked?? Saving gold heads may be stunting my progress more than helping. The long-term resource value feels unclear.",
    },
    {
      external_id: "t3_seed_monetization_1",
      parent_id: null,
      platform: "reddit",
      subreddit: "RiseofKingdoms",
      post_type: "submission",
      title: "Priority for low spenders",
      body: "I want to know the best way to spend money as a low spender because bundle value is hard to judge.",
      author_name: "Errorsansyt13",
      score: 5,
      comments_count: 26,
      post_url: "https://www.reddit.com/r/RiseofKingdoms/comments/1s9wq6g/priority_for_low_spenders/",
      created_at_source: iso(8),
      combined_text: "Priority for low spenders I want to know the best way to spend money as a low spender because bundle value is hard to judge.",
    },
    {
      external_id: "t3_seed_bug_1",
      parent_id: null,
      platform: "reddit",
      subreddit: "RiseofKingdoms",
      post_type: "submission",
      title: "Bug",
      body: "What happened? I cannot forge weapons either.",
      author_name: "andidwip11",
      score: 4,
      comments_count: 11,
      post_url: "https://www.reddit.com/r/RiseofKingdoms/comments/1s8m5xm/bug/",
      created_at_source: iso(40),
      combined_text: "Bug What happened? I cannot forge weapons either.",
    },
    {
      external_id: "t1_seed_balance_1",
      parent_id: "t3_seed_balance_parent",
      platform: "reddit",
      subreddit: "RiseofKingdoms",
      post_type: "comment",
      title: "What are some common mistakes new players make with commanders?",
      body: "Archers are still the meta for a long while and that balance direction limits variety.",
      author_name: "Top_Fly1091",
      score: 1,
      comments_count: 0,
      post_url: "https://www.reddit.com/r/RiseofKingdoms/comments/1s9b300/what_are_some_common_mistakes_new_players_make/odo8m4i",
      created_at_source: iso(19),
      combined_text: "What are some common mistakes new players make with commanders? Archers are still the meta for a long while and that balance direction limits variety.",
    },
    {
      external_id: "t3_seed_matchmaking_1",
      parent_id: null,
      platform: "reddit",
      subreddit: "RiseofKingdoms",
      post_type: "submission",
      title: "SoC Matchmaking",
      body: "Is SoC matchmaking based on top 300 or ch25? Players keep asking because matching rules are not obvious.",
      author_name: "Admirable_Novel9150",
      score: 1,
      comments_count: 6,
      post_url: "https://www.reddit.com/r/RiseofKingdoms/comments/1s7pzjo/soc_matchmaking/",
      created_at_source: iso(54),
      combined_text: "SoC Matchmaking Is SoC matchmaking based on top 300 or ch25? Players keep asking because matching rules are not obvious.",
    },
    {
      external_id: "t1_seed_server_1",
      parent_id: "t3_seed_server_parent",
      platform: "reddit",
      subreddit: "RiseofKingdoms",
      post_type: "comment",
      title: "Where did kvk originate?",
      body: "Older cross-server experiences felt smoother. The current server experience is harder to trust.",
      author_name: "DirkishDelight",
      score: 2,
      comments_count: 0,
      post_url: "https://www.reddit.com/r/RiseofKingdoms/comments/1s95qb3/where_did_kvk_originate/odm40xd",
      created_at_source: iso(28),
      combined_text: "Where did kvk originate? Older cross-server experiences felt smoother. The current server experience is harder to trust.",
    },
  ];
}

function getTopicSignalSummary(topicKey, rawPosts, rules = getRules()) {
  const topic = (rules.taxonomy || []).find((item) => item.key === topicKey);
  if (!topic) return "";

  const signals = new Map();
  for (const alias of topic.aliases || []) {
    const value = String(alias || "").toLowerCase();
    if (!value || value === "op") continue;
    signals.set(value, 0);
  }

  for (const raw of rawPosts || []) {
    const directText = getDirectTopicText(raw);
    for (const alias of signals.keys()) {
      if (testTopicAliasMatch(topicKey, alias, directText)) {
        signals.set(alias, (signals.get(alias) || 0) + 1);
      }
    }
  }

  return [...signals.entries()]
    .filter((entry) => entry[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map((entry) => entry[0])
    .join("\u3001");
}

function getDynamicTopicRootCause(topicKey, riskLevel, rawPosts, rules = getRules()) {
  const label = TOPIC_LABEL_ZH[topicKey] || topicKey;
  const focus = TOPIC_FOCUS[topicKey] || "\u73a9\u5bb6\u4f53\u9a8c";
  const signalText = getTopicSignalSummary(topicKey, rawPosts, rules);
  const submissionCount = (rawPosts || []).filter((item) => item.post_type === "submission").length;
  const commentCount = (rawPosts || []).filter((item) => item.post_type === "comment").length;

  const focusSentence = signalText
    ? `${label}\u76f8\u5173\u53cd\u9988\u4e3b\u8981\u805a\u7126\u5728${signalText}\uff0c\u6838\u5fc3\u6307\u5411${focus}\u3002`
    : `${label}\u76f8\u5173\u53cd\u9988\u4e3b\u8981\u6307\u5411${focus}\u3002`;

  const spreadSentence =
    submissionCount > 0 && commentCount > 0
      ? "\u8be5\u95ee\u9898\u540c\u65f6\u51fa\u73b0\u5728\u539f\u5e16\u548c\u8bc4\u8bba\u4e2d\uff0c\u8ba8\u8bba\u6b63\u5728\u6269\u6563\u3002"
      : submissionCount > 0
        ? "\u8be5\u95ee\u9898\u4ee5\u539f\u5e16\u76f4\u63a5\u53cd\u9988\u4e3a\u4e3b\u3002"
        : "\u8be5\u95ee\u9898\u76ee\u524d\u4e3b\u8981\u5728\u8bc4\u8bba\u533a\u88ab\u6301\u7eed\u63d0\u53ca\u3002";

  const riskSentence =
    riskLevel === "red"
      ? "\u5f53\u524d\u5df2\u8fdb\u5165\u9ad8\u98ce\u9669\u533a\u95f4\u3002"
      : riskLevel === "orange"
        ? "\u5f53\u524d\u5904\u4e8e\u91cd\u70b9\u89c2\u5bdf\u533a\u95f4\u3002"
        : "\u5f53\u524d\u4ecd\u5c5e\u4e8e\u5e38\u89c4\u89c2\u5bdf\u9636\u6bb5\u3002";

  return `${focusSentence}${spreadSentence}${riskSentence}`;
}

function getDynamicActionSuggestion(topicKey, riskLevel, rawPosts, rules = getRules()) {
  const focus = TOPIC_FOCUS[topicKey] || "\u73a9\u5bb6\u4f53\u9a8c";
  const signalText = getTopicSignalSummary(topicKey, rawPosts, rules);
  const target = signalText ? `${signalText} \u76f8\u5173\u95ee\u9898` : focus;

  if (riskLevel === "red") {
    return `\u5efa\u8bae\u7acb\u5373\u6838\u5bf9${target}\u7684\u771f\u5b9e\u5f71\u54cd\u8303\u56f4\uff0c\u6574\u7406\u53d7\u5f71\u54cd\u73a9\u5bb6\u573a\u666f\uff0c\u5e76\u5c3d\u5feb\u51c6\u5907\u5bf9\u5916\u8bf4\u660e\u3001\u4fee\u590d\u8282\u594f\u6216\u8865\u507f\u53e3\u5f84\u3002`;
  }

  if (riskLevel === "orange") {
    return `\u5efa\u8bae\u4f18\u5148\u590d\u76d8${target}\u7684\u53cd\u9988\u6765\u6e90\uff0c\u786e\u8ba4\u662f\u5426\u9700\u8981\u8c03\u4f18\u914d\u7f6e\u3001\u8865\u5145\u8bf4\u660e\uff0c\u6216\u63d0\u524d\u51c6\u5907\u8fd0\u8425\u56de\u5e94\u3002`;
  }

  return `\u5efa\u8bae\u6301\u7eed\u6536\u96c6${target}\u7684\u65b0\u589e\u53cd\u9988\uff0c\u7ed3\u5408\u540e\u7eed\u5e16\u5b50\u91cf\u548c\u70ed\u5ea6\u53d8\u5316\u5224\u65ad\u662f\u5426\u9700\u8981\u5347\u7ea7\u5904\u7406\u3002`;
}

function getWeightedRiskSummary(posts) {
  const items = (posts || []).filter((item) => !item.ignored);
  const redCount = items.filter((item) => item.riskLevel === "red").length;
  const orangeCount = items.filter((item) => item.riskLevel === "orange").length;
  const greenCount = items.filter((item) => item.riskLevel === "green").length;
  const discussionHeat = items.reduce((sum, item) => sum + (item.score || 0) + (item.commentsCount || 0), 0);

  if (!items.length) {
    return {
      score: 100,
      weightedRisk: 0,
      redCount: 0,
      orangeCount: 0,
      greenCount: 0,
      discussionHeat: 0,
    };
  }

  let weightedRisk = 0;
  let weightBase = 0;
  for (const item of items) {
    const heatWeight = Math.min(2.5, 1 + ((Number(item.score || 0) + Number(item.commentsCount || 0) * 2) / 150));
    const impactWeight = 0.8 + Number(item.impact || 0);
    const formatWeight = item.postType === "submission" ? 1.15 : 1;
    const exposure = heatWeight * impactWeight * formatWeight;
    weightedRisk += getRiskIntensity(item.riskLevel) * exposure;
    weightBase += exposure;
  }

  const averageRisk = weightBase > 0 ? weightedRisk / weightBase : 0;
  const concentrationPenalty = Math.min(15, redCount * 2.5 + orangeCount * 0.6);
  const score = Math.round(Math.max(0, Math.min(100, (1 - averageRisk) * 100 - concentrationPenalty + 8)));

  return {
    score,
    weightedRisk: Number(averageRisk.toFixed(4)),
    redCount,
    orangeCount,
    greenCount,
    discussionHeat,
  };
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 15000);
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          "User-Agent": REDDIT_USER_AGENT,
          Accept: "application/json",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
          Referer: "https://shilongradar.fun/",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Fetch failed ${response.status}: ${url}`);
      }

      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Fetch failed: ${url}`);
}

async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 15000);
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          "User-Agent": REDDIT_USER_AGENT,
          Accept: "application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
          Referer: "https://shilongradar.fun/",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Fetch failed ${response.status}: ${url}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Fetch failed: ${url}`);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(value) {
  return sanitizeText(
    decodeHtmlEntities(String(value || ""))
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function getXmlTagValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1] : "";
}

function getXmlLinkHref(xml) {
  const match = String(xml || "").match(/<link\b[^>]*href="([^"]+)"/i);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function parseRssEntries(xml) {
  return [...String(xml || "").matchAll(/<entry\b[\s\S]*?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
}

function normalizeRedditPath(link) {
  try {
    const url = new URL(link);
    return `${url.pathname.replace(/\/+$/, "")}/`;
  } catch {
    return "";
  }
}

function normalizeRssListing(subreddit, xml) {
  const children = parseRssEntries(xml).map((entry) => {
    const link = getXmlLinkHref(entry);
    const permalink = normalizeRedditPath(link);
    const postIdMatch = permalink.match(/\/comments\/([a-z0-9]+)\//i);
    const postId = postIdMatch ? postIdMatch[1] : "";
    const title = stripHtml(getXmlTagValue(entry, "title"));
    const body = stripHtml(getXmlTagValue(entry, "content") || getXmlTagValue(entry, "summary"));
    const authorBlock = getXmlTagValue(entry, "author");
    const author = stripHtml(getXmlTagValue(authorBlock, "name"));
    const updated = getXmlTagValue(entry, "updated") || getXmlTagValue(entry, "published");
    const createdUtc = updated ? Math.floor(new Date(updated).getTime() / 1000) : 0;

    return {
      kind: "t3",
      data: {
        id: postId || `rss_${Math.random().toString(16).slice(2)}`,
        title,
        selftext: body,
        author,
        score: 0,
        num_comments: 0,
        permalink: permalink || `/r/${subreddit}/`,
        created_utc: createdUtc,
      },
    };
  });

  return {
    data: {
      children,
      after: null,
    },
  };
}

function normalizeRssComments(xml, commentsPerPost, postTitle, fallbackPermalink) {
  const entries = parseRssEntries(xml)
    .slice(0, commentsPerPost)
    .map((entry, index) => {
      const link = getXmlLinkHref(entry);
      const normalizedLink = normalizeRedditPath(link) || fallbackPermalink;
      const parts = normalizedLink.split("/").filter(Boolean);
      const commentId = parts[parts.length - 1] || `rss_comment_${index}`;
      const authorBlock = getXmlTagValue(entry, "author");
      const author = stripHtml(getXmlTagValue(authorBlock, "name"));
      const body = stripHtml(getXmlTagValue(entry, "content") || getXmlTagValue(entry, "summary"));
      const updated = getXmlTagValue(entry, "updated") || getXmlTagValue(entry, "published");
      const createdUtc = updated ? Math.floor(new Date(updated).getTime() / 1000) : 0;

      return {
        kind: "t1",
        data: {
          id: commentId,
          author,
          body,
          score: 0,
          created_utc: createdUtc,
        },
        __meta: {
          title: postTitle,
          permalink: normalizedLink,
        },
      };
    });

  return [{ data: { children: [] } }, { data: { children: entries } }];
}

function buildRedditListingUrls(subreddit, postsPerPage, after) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const candidates = [
    `https://www.reddit.com/r/${subreddit}/new.json`,
    `https://www.reddit.com/r/${subreddit}/new/.json`,
    `https://api.reddit.com/r/${subreddit}/new`,
    `https://old.reddit.com/r/${subreddit}/new/.json`,
  ];

  return candidates.map((baseUrl) => {
    const url = new URL(baseUrl);
    url.searchParams.set("limit", String(postsPerPage));
    url.searchParams.set("raw_json", "1");
    url.searchParams.set("sort", "new");
    url.searchParams.set("_", nonce);
    if (after) {
      url.searchParams.set("after", after);
    }
    return url.toString();
  });
}

async function fetchRedditListing(subreddit, postsPerPage, after, options = {}) {
  let lastError = null;
  const rssUrl = `https://www.reddit.com/r/${subreddit}/new/.rss?limit=${postsPerPage}&sort=new&_=${Date.now()}`;

  if (options.preferRss) {
    try {
      const xml = await fetchText(rssUrl, options);
      return normalizeRssListing(subreddit, xml);
    } catch (error) {
      lastError = error;
    }

    if (options.skipJsonFallback) {
      throw lastError || new Error(`Failed to fetch Reddit listing for r/${subreddit}`);
    }
  }

  for (const url of buildRedditListingUrls(subreddit, postsPerPage, after)) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const xml = await fetchText(rssUrl, options);
    return normalizeRssListing(subreddit, xml);
  } catch (error) {
    lastError = error;
  }

  throw lastError || new Error(`Failed to fetch Reddit listing for r/${subreddit}`);
}

function buildRedditCommentUrls(permalink, commentsPerPost) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sanitizedPermalink = String(permalink || "").replace(/^\//, "");
  const candidates = [
    `https://www.reddit.com/${sanitizedPermalink}.json`,
    `https://api.reddit.com/${sanitizedPermalink}`,
    `https://old.reddit.com/${sanitizedPermalink}.json`,
  ];

  return candidates.map((baseUrl) => {
    const url = new URL(baseUrl);
    url.searchParams.set("limit", String(commentsPerPost));
    url.searchParams.set("depth", "1");
    url.searchParams.set("raw_json", "1");
    url.searchParams.set("sort", "new");
    url.searchParams.set("_", nonce);
    return url.toString();
  });
}

async function fetchRedditComments(permalink, commentsPerPost, options = {}) {
  let lastError = null;
  const rssUrl = `https://www.reddit.com${permalink}.rss?limit=${commentsPerPost}&sort=new&_=${Date.now()}`;

  if (options.preferRss) {
    try {
      const xml = await fetchText(rssUrl, options);
      return normalizeRssComments(xml, commentsPerPost, "", permalink);
    } catch (error) {
      lastError = error;
    }

    if (options.skipJsonFallback) {
      throw lastError || new Error(`Failed to fetch Reddit comments for ${permalink}`);
    }
  }

  for (const url of buildRedditCommentUrls(permalink, commentsPerPost)) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const xml = await fetchText(rssUrl, options);
    return normalizeRssComments(xml, commentsPerPost, "", permalink);
  } catch (error) {
    lastError = error;
  }

  throw lastError || new Error(`Failed to fetch Reddit comments for ${permalink}`);
}

async function getRedditFeedback({ force = false } = {}) {
  const state = getState();
  const sources = await readSources();
  const store = await hydrateStateFromStore();
  const volatileRuntime = isVolatileVercelRuntime();
  const ttlMs = isVolatileVercelRuntime() ? 0 : Math.max(1, Number(sources.syncIntervalMinutes || 30)) * 60 * 1000;

  if (!force && state.cache.raw && Date.now() - state.cache.rawAt < ttlMs) {
    return state.cache.raw;
  }

  const persistedRaw = Array.isArray(store.raw_posts) ? store.raw_posts : [];
  const lastSyncMs = store.meta?.lastSyncAt ? new Date(store.meta.lastSyncAt).getTime() : 0;

  if (!force && isVolatileVercelRuntime() && persistedRaw.length) {
    state.cache.raw = persistedRaw;
    state.cache.rawAt = Date.now();
    return persistedRaw;
  }

  if (!force && persistedRaw.length && lastSyncMs && Date.now() - lastSyncMs < ttlMs) {
    state.cache.raw = persistedRaw;
    state.cache.rawAt = Date.now();
    return persistedRaw;
  }

  const liveSyncMode = volatileRuntime && force;
  const postsPerPage = Math.min(Number(sources.limits?.postsPerSubreddit || 50), liveSyncMode ? 25 : volatileRuntime ? 35 : 50);
  const configuredCommentsPerPost = Number(sources.limits?.commentsPerPost || 4);
  const commentsPerPost = volatileRuntime
    ? (force ? Math.max(1, Math.min(configuredCommentsPerPost, liveSyncMode ? 1 : 2)) : 0)
    : configuredCommentsPerPost;
  const lookbackDays = Number(sources.lookbackDays || 3);
  const cutoffTs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const requestOptions = liveSyncMode
    ? { timeoutMs: 6000, maxAttempts: 2, preferRss: false, skipJsonFallback: false }
    : volatileRuntime
      ? { timeoutMs: 8000, maxAttempts: 2 }
      : {};
  const results = [];
  const maxCommentFetchPosts = liveSyncMode ? 1 : Number.MAX_SAFE_INTEGER;

  try {
    for (const subreddit of sources.subreddits || []) {
      let after = null;
      let reachedCutoff = false;
      let pageCount = 0;
      let commentFetchCount = 0;

      while (!reachedCutoff && pageCount < (liveSyncMode ? 2 : volatileRuntime ? 6 : 10)) {
        pageCount += 1;
        const listing = await fetchRedditListing(subreddit, postsPerPage, after, requestOptions);
        const children = listing?.data?.children || [];
        if (!children.length) break;

        for (const child of children) {
          const post = child.data;
          const createdMs = Number(post.created_utc || 0) * 1000;
          if (createdMs < cutoffTs) {
            reachedCutoff = true;
            continue;
          }

          const postTitle = sanitizeText(post.title);
          const postBody = sanitizeText(post.selftext);
          const permalink = String(post.permalink || "");
          const externalId = `t3_${post.id}`;

          results.push({
            external_id: externalId,
            parent_id: null,
            platform: "reddit",
            subreddit,
            post_type: "submission",
            title: postTitle,
            body: postBody,
            author_name: sanitizeText(post.author),
            score: Number(post.score || 0),
            comments_count: Number(post.num_comments || 0),
            post_url: `https://www.reddit.com${permalink}`,
            created_at_source: new Date(createdMs).toISOString(),
            combined_text: sanitizeText(`${postTitle} ${postBody}`),
          });

          if (commentsPerPost > 0 && commentFetchCount < maxCommentFetchPosts) {
            try {
              commentFetchCount += 1;
              const commentResponse = await fetchRedditComments(permalink, commentsPerPost, requestOptions);
              const commentListing = commentResponse?.[1];
              const commentChildren = commentListing?.data?.children || [];
              let counter = 0;

              for (const commentChild of commentChildren) {
                if (commentChild.kind !== "t1" || counter >= commentsPerPost) continue;
                const comment = commentChild.data;
                if (!String(comment.body || "").trim()) continue;
                const commentCreatedMs = Number(comment.created_utc || 0) * 1000;
                if (commentCreatedMs < cutoffTs) continue;

                counter += 1;
                const commentBody = sanitizeText(comment.body);
                results.push({
                  external_id: `t1_${comment.id}`,
                  parent_id: externalId,
                  platform: "reddit",
                  subreddit,
                  post_type: "comment",
                  title: postTitle,
                  body: commentBody,
                  author_name: sanitizeText(comment.author),
                  score: Number(comment.score || 0),
                  comments_count: 0,
                  post_url: `https://www.reddit.com${permalink}${comment.id}`,
                  created_at_source: new Date(commentCreatedMs).toISOString(),
                  combined_text: sanitizeText(`${postTitle} ${commentBody}`),
                });
              }
            } catch (error) {
              console.error("Failed to fetch comments", error);
            }
          }
        }

        after = listing?.data?.after || null;
        if (!after) break;
      }
    }
  } catch (error) {
    console.error("Falling back from live Reddit fetch", error);
    if (persistedRaw.length) {
      state.cache.raw = persistedRaw;
      state.cache.rawAt = Date.now();
      return persistedRaw;
    }

    const fallback = getFallbackRawPosts();
    state.cache.raw = fallback;
    state.cache.rawAt = Date.now();
    return fallback;
  }

  const deduped = Object.values(
    results.reduce((acc, item) => {
      if (!acc[item.external_id]) acc[item.external_id] = item;
      return acc;
    }, {})
  ).sort((a, b) => new Date(b.created_at_source) - new Date(a.created_at_source));

  state.cache.raw = deduped;
  state.cache.rawAt = Date.now();
  return deduped;
}

function getRepresentativeRawForTopic(analysisItems, rawPosts) {
  const candidates = [];

  for (const analysis of analysisItems.filter((item) => !item.ignored)) {
    const raw = rawPosts.find((item) => item.external_id === analysis.external_id);
    if (!raw) continue;

    const alias = String(analysis.topic_match_alias || "");
    const title = String(raw.title || "");
    const body = String(raw.body || "");
    let titleHasAlias = 0;
    let bodyHasAlias = 0;

    if (alias) {
      const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(alias.toLowerCase())}(?![a-z0-9])`, "i");
      if (pattern.test(title.toLowerCase())) titleHasAlias = 1;
      if (pattern.test(body.toLowerCase())) bodyHasAlias = 1;
    }

    candidates.push({
      raw,
      isSubmission: raw.post_type === "submission" ? 1 : 0,
      titleHasAlias,
      bodyHasAlias,
      hasAlias: alias ? 1 : 0,
      riskPriority: getRiskPriority(analysis.risk_level),
      impact: Number(analysis.impact || 0),
      commentsCount: Number(raw.comments_count || 0),
      score: Number(raw.score || 0),
      createdAt: new Date(raw.created_at_source),
    });
  }

  candidates.sort((a, b) =>
    b.titleHasAlias - a.titleHasAlias ||
    b.isSubmission - a.isSubmission ||
    b.bodyHasAlias - a.bodyHasAlias ||
    b.hasAlias - a.hasAlias ||
    b.riskPriority - a.riskPriority ||
    b.impact - a.impact ||
    b.commentsCount - a.commentsCount ||
    b.score - a.score ||
    b.createdAt - a.createdAt
  );

  return candidates[0]?.raw || null;
}

function getRecentPosts(posts, hours = 72) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return (posts || []).filter((post) => !post.ignored && new Date(post.createdAt).getTime() >= cutoff);
}

function getRawLookbackCutoff(lookbackDays = 3) {
  return Date.now() - Math.max(1, Number(lookbackDays || 3)) * 24 * 60 * 60 * 1000;
}

function pruneRawPostsToLookback(rawPosts, lookbackDays = 3) {
  const cutoff = getRawLookbackCutoff(lookbackDays);
  return (rawPosts || []).filter((item) => {
    const createdAt = new Date(item.created_at_source || 0).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
}

function mergeRawPosts(existingRawPosts, incomingRawPosts, lookbackDays = 3) {
  const merged = new Map();

  for (const item of pruneRawPostsToLookback(existingRawPosts, lookbackDays)) {
    merged.set(item.external_id, item);
  }

  for (const item of pruneRawPostsToLookback(incomingRawPosts, lookbackDays)) {
    merged.set(item.external_id, item);
  }

  return [...merged.values()].sort((a, b) => new Date(b.created_at_source) - new Date(a.created_at_source));
}

function buildAlerts(issues) {
  const today = new Date().toISOString().slice(0, 10);
  return issues
    .filter((item) => item.riskLevel === "red" || item.riskLevel === "orange")
    .slice(0, 5)
    .map((issue) => ({
      alert_id: `alert-${issue.key}-${today}`,
      snapshot_date: today,
      topic_key: issue.key,
      topic_label: issue.label,
      risk_level: issue.riskLevel,
      trigger_reason:
        issue.riskLevel === "red"
          ? "Critical keywords indicate boycott, refund, quit, scam, or exploit risk."
          : "Warning keywords indicate balance, whale, or nerf driven dissatisfaction.",
      representative_post_url: issue.representativePost?.post_url || "",
      root_cause_summary: issue.rootCause,
      action_suggestion: issue.actionSuggestion,
      owner_name: "Overseas Ops",
      delivery_channel: issue.riskLevel === "red" ? "Feishu + WeCom" : "Dashboard + Feishu",
      delivered_at: null,
    }));
}

async function buildDataset({ force = false, rawPostsOverride = null, storeOverride = null, persist = true, lastSyncAtOverride = null } = {}) {
  const state = getState();
  const sources = await readSources();
  const store = storeOverride ? normalizeStoreShape(storeOverride) : await hydrateStateFromStore();
  const ttlMs = isVolatileVercelRuntime() ? 0 : Math.max(1, Number(sources.syncIntervalMinutes || 30)) * 60 * 1000;

  if (!force && !rawPostsOverride && !storeOverride && state.cache.dataset && Date.now() - state.cache.datasetAt < ttlMs) {
    return state.cache.dataset;
  }

  const rules = getRules();
  const rawPosts = Array.isArray(rawPostsOverride) ? rawPostsOverride : await getRedditFeedback({ force });
  const reviewLabels = Array.isArray(store.review_labels) ? store.review_labels : [];
  const reviewMap = new Map(reviewLabels.map((item) => [item.postId, item]));

  const analysisItems = rawPosts.map((raw) => {
    const topicMatch = getTopicMatch(getDirectTopicText(raw), rules);
    const topic = topicMatch ? topicMatch.key : "other";
    const sentiment = getSentiment(raw.combined_text, rules);
    const impact = Math.min(1, (Number(raw.score || 0) + Number(raw.comments_count || 0) * 2) / 500);
    const riskLevel = getContentRiskLevel(raw.combined_text, rules);
    const review = reviewMap.get(raw.external_id);

    return {
      external_id: raw.external_id,
      topic_key: review?.topic || review?.corrected_topic_key || topic,
      topic_match_alias: topicMatch ? topicMatch.alias : null,
      sentiment: review?.sentiment || review?.corrected_sentiment || sentiment,
      impact: Number(impact.toFixed(2)),
      root_cause_summary: "",
      action_suggestion: "",
      risk_score: getRiskScoreFromLevel(riskLevel),
      risk_level: riskLevel,
      ignored: Boolean(review?.ignored),
    };
  });

  const issues = (rules.taxonomy || [])
    .map((topic) => {
      const analysis = analysisItems.filter((item) => item.topic_key === topic.key && !item.ignored);
      if (!analysis.length) return null;
      const negativeItems = analysis.filter((item) => item.sentiment === "negative");
      const raw = rawPosts
        .filter((item) => analysis.some((analysisItem) => analysisItem.external_id === item.external_id))
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      const heat = raw.reduce((sum, item) => sum + Number(item.score || 0) + Number(item.comments_count || 0), 0);

      const now = Date.now();
      const currentWindow = analysis.filter((item) => {
        const rawItem = rawPosts.find((rawPost) => rawPost.external_id === item.external_id);
        return rawItem && now - new Date(rawItem.created_at_source).getTime() <= 24 * 60 * 60 * 1000;
      }).length;
      const previousWindow = analysis.length - currentWindow;
      const baseline = Math.max(1, previousWindow || currentWindow || 1);
      const growth = Number((((currentWindow - baseline) / baseline) || 0).toFixed(2));

      let riskLevel = "green";
      if (analysis.some((item) => item.risk_level === "red")) {
        riskLevel = "red";
      } else if (analysis.some((item) => item.risk_level === "orange")) {
        riskLevel = "orange";
      }

      const riskScore = getRiskScoreFromLevel(riskLevel);
      const representativePost = getRepresentativeRawForTopic(analysis, raw);
      const rootCause = getDynamicTopicRootCause(topic.key, riskLevel, raw, rules);
      const actionSuggestion = getDynamicActionSuggestion(topic.key, riskLevel, raw, rules);

      return {
        key: topic.key,
        label: topic.label,
        occurrenceCount: analysis.length,
        negativeCount: negativeItems.length,
        negativeShare: Number((negativeItems.length / Math.max(1, analysis.length)).toFixed(2)),
        heat,
        growth,
        trend: [riskScore, riskScore],
        riskScore,
        riskLevel,
        riskCopy: getRiskDisplayCopy(riskLevel),
        rootCause,
        actionSuggestion,
        representativePost,
      };
    })
    .filter(Boolean)
    .sort((a, b) => getRiskPriority(b.riskLevel) - getRiskPriority(a.riskLevel) || b.heat - a.heat);

  const totalIssueOccurrences = Math.max(1, issues.reduce((sum, item) => sum + item.occurrenceCount, 0));
  for (const issue of issues) {
    issue.riskShare = Number((issue.occurrenceCount / totalIssueOccurrences).toFixed(2));
  }

  const issueMap = new Map(issues.map((item) => [item.key, item]));
  const posts = rawPosts
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .map((raw) => {
      const analysis = analysisItems.find((item) => item.external_id === raw.external_id);
      if (!analysis) return null;

      let topCommentPreview = null;
      if (raw.post_type === "submission") {
        const topCommentRaw = rawPosts
          .filter((item) => item.post_type === "comment" && item.parent_id === raw.external_id)
          .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];

        if (topCommentRaw) {
          topCommentPreview = {
            id: topCommentRaw.external_id,
            author: topCommentRaw.author_name,
            body: topCommentRaw.body,
            score: Number(topCommentRaw.score || 0),
            url: topCommentRaw.post_url,
          };
        }
      }

      const issue = issueMap.get(analysis.topic_key);
      return {
        id: raw.external_id,
        parentId: raw.parent_id,
        postType: raw.post_type,
        subreddit: raw.subreddit,
        title: raw.post_type === "comment" ? `Comment on: ${raw.title}` : raw.title,
        originalTitle: raw.title,
        body: raw.body,
        author: raw.author_name,
        score: Number(raw.score || 0),
        commentsCount: Number(raw.comments_count || 0),
        createdAt: raw.created_at_source,
        url: raw.post_url,
        topic: analysis.topic_key,
        sentiment: analysis.sentiment,
        riskLevel: analysis.risk_level,
        riskCopy: getRiskDisplayCopy(analysis.risk_level),
        rootCause: issue?.rootCause || "",
        actionSuggestion: issue?.actionSuggestion || "",
        ignored: Boolean(analysis.ignored),
        impact: Number(analysis.impact || 0),
        topCommentPreview,
      };
    })
    .filter(Boolean);

  const recentPosts = getRecentPosts(posts, 72);
  const recentSubmissions = recentPosts.filter((item) => item.postType === "submission");
  const recentComments = recentPosts.filter((item) => item.postType === "comment");
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  const baselinePosts = recentPosts.filter((item) => new Date(item.createdAt).getTime() < cutoff24h);
  const overviewSummary = getWeightedRiskSummary(recentPosts);
  const baselineSummary = baselinePosts.length ? getWeightedRiskSummary(baselinePosts) : overviewSummary;
  const overviewScore = overviewSummary.score;
  const overviewRiskChange = overviewScore - baselineSummary.score;
  const overviewGrowthRate =
    baselineSummary.score > 0 ? Number((((overviewScore - baselineSummary.score) / Math.max(1, baselineSummary.score))).toFixed(4)) : 0;
  const topIssue = issues[0] || null;
  const overviewRiskLevel = getWeatherLevelFromScore(overviewScore);
  const alerts = buildAlerts(issues);

  const lastSyncAt = lastSyncAtOverride || store.meta?.lastSyncAt || new Date().toISOString();

  const overview = {
    game: sources.game?.name || "Game",
    sources: (sources.subreddits || []).map((item) => `r/${item}`),
    riskScore: overviewScore,
    riskLevel: overviewRiskLevel,
    weatherLevel: overviewRiskLevel,
    weatherLabel: getWeatherLabel(overviewRiskLevel),
    needleAngle: Number((-90 + overviewScore * 1.8).toFixed(2)),
    riskCopy: getWeatherAdvice(overviewRiskLevel),
    riskChange: overviewRiskChange,
    negativeVolume: overviewSummary.redCount,
    redRiskCount: overviewSummary.redCount,
    orangeRiskCount: overviewSummary.orangeCount,
    greenRiskCount: overviewSummary.greenCount,
    discussionHeat: overviewSummary.discussionHeat,
    growthRate: overviewGrowthRate,
    alertsCount: alerts.length,
    totalPosts: recentPosts.length,
    totalSubmissions: recentSubmissions.length,
    totalComments: recentComments.length,
    topTopic: topIssue,
    executiveSummary: topIssue
      ? `${topIssue.label} is the biggest live risk source in the last 72 hours.`
      : "No major live risk is visible yet.",
    lastSyncAt,
  };

  const report = {
    title: `${sources.game?.name || "Game"} Daily Risk Brief`,
    subtitle: `Sources: ${(sources.subreddits || []).map((item) => `r/${item}`).join(" / ")}`,
    executiveSummary: overview.executiveSummary,
    executiveDetail: topIssue ? `${topIssue.label} risk score is ${topIssue.riskScore}. ${topIssue.rootCause}` : overview.executiveSummary,
    metrics: [
      { label: "Overall risk", value: overview.riskScore, hint: overview.riskLevel },
      { label: "Negative items", value: overview.negativeVolume, hint: "negative submissions/comments" },
      { label: "Active alerts", value: overview.alertsCount, hint: "high-risk or accelerating topics" },
      { label: "Discussion heat", value: overview.discussionHeat, hint: "score + comments" },
    ],
    topTopics: issues.slice(0, 3),
    actions: alerts.map((item) => ({
      title: `${item.topic_label} - ${item.owner_name}`,
      body: `${item.trigger_reason} ${item.action_suggestion}`,
    })),
    featuredPosts: posts.filter((item) => !item.ignored).slice(0, 4),
  };

  const reviewQueue = posts.filter((item) => (item.sentiment === "negative" || item.impact >= 0.65) && !item.ignored).slice(0, 20);

  const dataset = {
    overview,
    issues,
    posts,
    alerts,
    taxonomy: rules.taxonomy,
    rules,
    report,
    reviewQueue,
    reviewActions: reviewLabels,
  };

  if (persist) {
    const persistedStore = normalizeStoreShape({
      ...store,
      raw_posts: rawPosts,
      analyzed_feedback: analysisItems,
      meta: {
        ...(store.meta || {}),
        lastSyncAt,
        game: sources.game?.name || store.meta?.game || "Rise of Kingdoms",
      },
      risk_daily_snapshot: issues.map((issue) => ({
        snapshot_date: new Date().toISOString().slice(0, 10),
        topic_key: issue.key,
        topic_label: issue.label,
        negative_volume: issue.negativeCount,
        negative_growth: issue.growth,
        discussion_heat: issue.heat,
        high_impact_count: posts.filter((item) => item.topic === issue.key && item.impact >= 0.65).length,
        risk_score: issue.riskScore,
        risk_level: issue.riskLevel,
      })),
      review_labels: reviewLabels,
      alerts,
      rule_config: rules,
    });
    await saveStore(persistedStore);
  }
  state.cache.dataset = dataset;
  state.cache.datasetAt = Date.now();
  return dataset;
}

async function syncLiveDataset() {
  const sources = await readSources();
  const lookbackDays = Number(sources.lookbackDays || 3);
  const store = await hydrateStateFromStore();
  const existingRawPosts = Array.isArray(store.raw_posts) ? store.raw_posts : [];
  const syncedAt = new Date().toISOString();

  forceRefresh();
  const liveRawPosts = await getRedditFeedback({ force: true });
  const mergedRawPosts = mergeRawPosts(existingRawPosts, liveRawPosts, lookbackDays);

  return buildDataset({
    force: false,
    rawPostsOverride: mergedRawPosts,
    storeOverride: store,
    persist: true,
    lastSyncAtOverride: syncedAt,
  });
}

async function setRules(payload) {
  const state = getState();
  const store = await hydrateStateFromStore();
  state.rules = {
    risk: {
      red: (payload?.risk?.red || []).map((item) => sanitizeText(item).toLowerCase()).filter(Boolean),
      orange: (payload?.risk?.orange || []).map((item) => sanitizeText(item).toLowerCase()).filter(Boolean),
      green: (payload?.risk?.green || []).map((item) => sanitizeText(item).toLowerCase()).filter(Boolean),
    },
    sentiment: {
      negativePhrases: (payload?.sentiment?.negativePhrases || []).map((item) => sanitizeText(item)).filter(Boolean),
      positive: (payload?.sentiment?.positive || []).map((item) => sanitizeText(item).toLowerCase()).filter(Boolean),
    },
    taxonomy: (payload?.taxonomy || [])
      .map((item) => ({
        key: sanitizeText(item.key).toLowerCase(),
        label: sanitizeText(item.label),
        aliases: (item.aliases || []).map((alias) => sanitizeText(alias).toLowerCase()).filter(Boolean),
      }))
      .filter((item) => item.key),
  };
  await saveStore({
    ...store,
    rule_config: state.rules,
    review_labels: state.reviewLabels || store.review_labels || [],
  });
  state.cache.dataset = null;
  state.cache.datasetAt = 0;
  return { ok: true, rules: state.rules };
}

async function saveReviewLabel(payload) {
  const state = getState();
  const store = await hydrateStateFromStore();
  const entry = {
    postId: payload.postId,
    topic: payload.topic,
    corrected_topic_key: payload.topic,
    sentiment: payload.sentiment,
    corrected_sentiment: payload.sentiment,
    ignored: Boolean(payload.ignored),
    note: payload.note || "",
    createdAt: new Date().toISOString(),
  };

  state.reviewLabels = (state.reviewLabels || []).filter((item) => item.postId !== payload.postId);
  state.reviewLabels.unshift(entry);
  await saveStore({
    ...store,
    review_labels: state.reviewLabels,
    rule_config: state.rules || store.rule_config || getDefaultRules(),
  });
  state.cache.dataset = null;
  state.cache.datasetAt = 0;
  return { ok: true };
}

function forceRefresh() {
  const state = getState();
  state.cache.raw = null;
  state.cache.dataset = null;
  state.cache.rawAt = 0;
  state.cache.datasetAt = 0;
  state.store = null;
}

async function getPostsResponse(query = {}) {
  const dataset = await buildDataset({ persist: false });
  const topic = query.topic || "all";
  const sentiment = query.sentiment || "all";
  const risk = query.risk || "all";
  const contentType = query.contentType || "all";
  const sort = query.sort || "time";
  let page = Number(query.page || 1);
  let pageSize = Number(query.pageSize || 10);
  page = Math.max(1, Number.isFinite(page) ? page : 1);
  pageSize = Math.min(50, Math.max(1, Number.isFinite(pageSize) ? pageSize : 10));

  let items = getRecentPosts(dataset.posts, 72);
  if (topic !== "all") items = items.filter((item) => item.topic === topic);
  if (sentiment !== "all") items = items.filter((item) => item.sentiment === sentiment);
  if (risk !== "all") items = items.filter((item) => item.riskLevel === risk);
  if (contentType !== "all") items = items.filter((item) => item.postType === contentType);

  items.sort((a, b) => {
    if (sort === "heat") {
      return (b.score + b.commentsCount * 3) - (a.score + a.commentsCount * 3) || new Date(b.createdAt) - new Date(a.createdAt);
    }
    return new Date(b.createdAt) - new Date(a.createdAt) || (b.score + b.commentsCount * 3) - (a.score + a.commentsCount * 3);
  });

  const total = items.length;
  const totalPages = total <= 0 ? 1 : Math.ceil(total / pageSize);
  page = Math.min(page, totalPages);
  const start = (page - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages,
  };
}

module.exports = {
  buildDataset,
  forceRefresh,
  getPostsResponse,
  getRules,
  loadRules,
  readSources,
  saveReviewLabel,
  setRules,
  syncLiveDataset,
};
