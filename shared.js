(function () {
  const API_BASE = "";
  const DEFAULT_GAME_KEY = "rise-of-kingdoms";
  const DEFAULT_GAME_CATALOG = [
    {
      key: "rise-of-kingdoms",
      slug: "rok",
      name: "Rise of Kingdoms",
      displayName: "万国觉醒",
      sourcesLabel: "r/RiseofKingdoms",
      placeholder: false,
    },
    {
      key: "new-game",
      slug: "new-game",
      name: "Lords Mobile",
      displayName: "王国纪元",
      sourcesLabel: "r/lordsmobile",
      placeholder: false,
    },
  ];
  const DEFAULT_TOPIC_LABELS = {
    matchmaking: "匹配",
    economy: "经济",
    monetization: "付费",
    event: "活动",
    progression: "进度",
    balance: "平衡",
    server: "服务器",
    bug: "Bug",
    "anti-cheat": "反作弊",
    social: "社交",
    onboarding: "新手引导",
  };

  let gameCatalogCache = clone(DEFAULT_GAME_CATALOG);
  let taxonomyCache = Object.entries(DEFAULT_TOPIC_LABELS).map(([key, label]) => ({ key, label }));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeGameKey(gameKey) {
    return String(gameKey || DEFAULT_GAME_KEY).trim().toLowerCase();
  }

  function resolveGameConfig(gameKey, games = gameCatalogCache) {
    const normalized = normalizeGameKey(gameKey);
    return (
      (games || []).find((item) => normalizeGameKey(item.key) === normalized || item.slug === normalized) ||
      (games || [])[0] ||
      DEFAULT_GAME_CATALOG[0]
    );
  }

  function getCurrentGameKey() {
    const params = new URLSearchParams(window.location.search);
    const pathGame = window.location.pathname.split("/").filter(Boolean)[0];
    if (pathGame && (gameCatalogCache || []).some((item) => item.slug === pathGame || item.key === pathGame)) {
      return resolveGameConfig(pathGame).key;
    }
    return resolveGameConfig(params.get("game")).key;
  }

  function isLocalLikeHost() {
    return window.location.protocol === "file:" || /^(127\.0\.0\.1|localhost)$/i.test(window.location.hostname);
  }

  function buildPageHref(page, gameKey = getCurrentGameKey()) {
    const game = resolveGameConfig(gameKey);
    const pageMap = {
      dashboard: "index.html",
      reports: "reports.html",
      review: "review.html",
    };

    if (isLocalLikeHost()) {
      const file = pageMap[page] || "index.html";
      return `./${file}?game=${encodeURIComponent(game.key)}`;
    }

    if (page === "dashboard") {
      return `/${game.slug}`;
    }
    return `/${game.slug}/${page}`;
  }

  function setTaxonomyCache(taxonomy) {
    if (Array.isArray(taxonomy) && taxonomy.length) {
      taxonomyCache = clone(taxonomy);
    }
  }

  function updateCachesFromPayload(payload) {
    if (!payload) return;

    if (Array.isArray(payload) && payload.length && payload.every((item) => item && typeof item === "object" && item.key)) {
      if (payload.some((item) => Object.prototype.hasOwnProperty.call(item, "slug"))) {
        gameCatalogCache = clone(payload);
        return;
      }

      setTaxonomyCache(payload);
      return;
    }

    if (Array.isArray(payload.games) && payload.games.length) {
      gameCatalogCache = clone(payload.games);
    }

    if (payload.taxonomy) {
      setTaxonomyCache(payload.taxonomy);
    }

    if (payload.rules && payload.rules.taxonomy) {
      setTaxonomyCache(payload.rules.taxonomy);
    }
  }

  async function realFetch(path, params = {}, method = "GET", options = {}) {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    const nextParams = { ...params };
    if (path.startsWith("/api/") && !nextParams.game && !options.skipGameParam) {
      nextParams.game = getCurrentGameKey();
    }

    Object.entries(nextParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });

    const response = await fetch(url.toString(), {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(nextParams),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    return response.json();
  }

  async function fetchApi(path, params = {}, method = "GET", options = {}) {
    if (window.location.protocol === "file:") {
      throw new Error("请先启动本地服务，再通过 http://127.0.0.1:8899/ 打开页面。");
    }

    const payload = await realFetch(path, params, method, options);
    updateCachesFromPayload(payload);
    return payload;
  }

  async function fetchGameCatalog() {
    try {
      const payload = await realFetch("/data/games.json", {}, "GET", { skipGameParam: true });
      if (Array.isArray(payload) && payload.length) {
        gameCatalogCache = clone(payload);
      }
    } catch (error) {
    }
    return clone(gameCatalogCache);
  }

  function getGameCatalog() {
    return clone(gameCatalogCache);
  }

  function formatRiskLabel(level) {
    const labels = (window.GameFeedbackUIConfig && window.GameFeedbackUIConfig.riskPalette) || {};
    return {
      red: labels.redLabel || "红色",
      orange: labels.orangeLabel || "橙色",
      green: labels.greenLabel || "绿色",
    }[level] || "绿色";
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function topicLabel(key) {
    const normalized = String(key || "").trim();
    const found = (taxonomyCache || []).find((item) => item.key === normalized);
    if (found && found.label) return found.label;
    return DEFAULT_TOPIC_LABELS[normalized] || normalized || "其他";
  }

  function renderTrendBars(values) {
    return (values || [])
      .map((value) => `<span class="trend-bar" style="height:${Math.max(10, value)}%"></span>`)
      .join("");
  }

  function riskBadgeClass(level) {
    return `risk-badge risk-${level}`;
  }

  function sentimentLabel(value) {
    return {
      negative: "负向",
      neutral: "中性",
      positive: "正向",
    }[value] || "中性";
  }

  function relativeDate(dateString) {
    const date = new Date(dateString);
    const diffMs = Date.now() - date.getTime();
    if (!Number.isFinite(diffMs) || diffMs <= 0) {
      return "刚刚";
    }

    const totalMinutes = Math.max(1, Math.floor(diffMs / 60000));
    if (totalMinutes < 60) {
      return `${totalMinutes}分钟前`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 24) {
      return minutes > 0 ? `${hours}小时${minutes}分钟前` : `${hours}小时前`;
    }

    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    if (remainHours > 0) {
      return `${days}天${remainHours}小时前`;
    }

    return `${days}天前`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "暂无";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "暂无";
    }

    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  window.GameFeedbackMonitor = {
    fetchGameCatalog,
    getGameCatalog,
    getCurrentGameKey,
    buildPageHref,
    fetchApi,
    setTaxonomyCache,
    topicLabel,
    formatNumber,
    formatPercent,
    formatRiskLabel,
    renderTrendBars,
    riskBadgeClass,
    sentimentLabel,
    relativeDate,
    formatDateTime,
  };
})();
