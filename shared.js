(function () {
  const STORAGE_KEY = "game-feedback-monitor-review-actions";
  const RULES_STORAGE_KEY = "game-feedback-monitor-rules";
  const API_BASE = "";

  const TAXONOMY = [
    { key: "matchmaking", label: "匹配", aliases: ["queue", "ranked", "match"] },
    { key: "economy", label: "经济", aliases: ["resource", "gold", "pricing"] },
    { key: "monetization", label: "付费", aliases: ["gacha", "banner", "shop", "spend"] },
    { key: "event", label: "活动", aliases: ["event", "limited", "calendar"] },
    { key: "progression", label: "成长", aliases: ["grind", "xp", "level"] },
    { key: "balance", label: "平衡", aliases: ["meta", "nerf", "buff"] },
    { key: "server", label: "服务器", aliases: ["lag", "disconnect", "ping"] },
    { key: "bug", label: "Bug", aliases: ["crash", "stuck", "broken"] },
    { key: "anti-cheat", label: "反作弊", aliases: ["hack", "cheat", "bot"] },
    { key: "social", label: "社交", aliases: ["guild", "friend", "chat"] },
    { key: "onboarding", label: "新手引导", aliases: ["tutorial", "new player", "first week"] },
  ];

  const BASE_POSTS = [
    {
      id: "p1",
      subreddit: "ProjectVanguard",
      title: "The new gacha pity change feels insulting",
      body: "Players are spending more and getting less. The banner pricing and pity reset are pushing people out.",
      author: "stormglass",
      score: 612,
      commentsCount: 284,
      createdAt: "2026-03-28T03:12:00Z",
      url: "https://reddit.com/r/ProjectVanguard/comments/p1",
      topic: "monetization",
      sentiment: "negative",
      impact: 0.96,
    },
    {
      id: "p2",
      subreddit: "ProjectVanguard",
      title: "Matchmaking keeps pairing solo players into stacked premades",
      body: "Ranked is miserable this week. Queue quality dropped hard after the reset.",
      author: "marlowe9",
      score: 488,
      commentsCount: 191,
      createdAt: "2026-03-28T05:45:00Z",
      url: "https://reddit.com/r/ProjectVanguard/comments/p2",
      topic: "matchmaking",
      sentiment: "negative",
      impact: 0.88,
    },
    {
      id: "p3",
      subreddit: "gachagaming",
      title: "Project Vanguard anniversary event is generous actually",
      body: "Not perfect, but the free pulls and extra stamina make the event feel much better than last month.",
      author: "mintlattice",
      score: 230,
      commentsCount: 76,
      createdAt: "2026-03-28T01:20:00Z",
      url: "https://reddit.com/r/gachagaming/comments/p3",
      topic: "event",
      sentiment: "positive",
      impact: 0.54,
    },
    {
      id: "p4",
      subreddit: "ProjectVanguard",
      title: "Server lag makes boss raids unplayable at reset time",
      body: "Three nights in a row, the server rubber bands and half the raid disconnects.",
      author: "burndawn",
      score: 365,
      commentsCount: 149,
      createdAt: "2026-03-27T23:54:00Z",
      url: "https://reddit.com/r/ProjectVanguard/comments/p4",
      topic: "server",
      sentiment: "negative",
      impact: 0.84,
    },
    {
      id: "p5",
      subreddit: "ProjectVanguard",
      title: "Balance patch killed every off-meta team",
      body: "The nerfs were too broad. Ranked feels solved already.",
      author: "quartznight",
      score: 312,
      commentsCount: 128,
      createdAt: "2026-03-27T21:00:00Z",
      url: "https://reddit.com/r/ProjectVanguard/comments/p5",
      topic: "balance",
      sentiment: "negative",
      impact: 0.79,
    },
    {
      id: "p6",
      subreddit: "ProjectVanguard",
      title: "The new player tutorial still doesn't explain gear crafting",
      body: "Friends bounced in the first hour because they had no idea how progression works.",
      author: "rookieorbit",
      score: 188,
      commentsCount: 64,
      createdAt: "2026-03-27T19:42:00Z",
      url: "https://reddit.com/r/ProjectVanguard/comments/p6",
      topic: "onboarding",
      sentiment: "negative",
      impact: 0.55,
    },
    {
      id: "p7",
      subreddit: "ProjectVanguard",
      title: "Economy feels better after the stamina refund",
      body: "The grind is still there, but at least daily farming no longer feels wasted.",
      author: "opalset",
      score: 142,
      commentsCount: 41,
      createdAt: "2026-03-27T14:18:00Z",
      url: "https://reddit.com/r/ProjectVanguard/comments/p7",
      topic: "economy",
      sentiment: "positive",
      impact: 0.39,
    },
    {
      id: "p8",
      subreddit: "ProjectVanguard",
      title: "Cheaters in top ladder are back again",
      body: "Weekend ranked was full of obvious aim bots and no one trusts the ladder right now.",
      author: "steelhalo",
      score: 274,
      commentsCount: 101,
      createdAt: "2026-03-28T02:48:00Z",
      url: "https://reddit.com/r/ProjectVanguard/comments/p8",
      topic: "anti-cheat",
      sentiment: "negative",
      impact: 0.74,
    },
  ];

  const BASE_TRENDS = {
    matchmaking: [28, 32, 30, 38, 49, 56, 65],
    economy: [14, 12, 10, 11, 14, 17, 16],
    monetization: [31, 35, 42, 47, 58, 71, 84],
    event: [9, 12, 15, 12, 13, 11, 10],
    progression: [16, 17, 21, 22, 24, 27, 31],
    balance: [22, 24, 29, 35, 37, 44, 52],
    server: [19, 21, 24, 29, 43, 48, 57],
    bug: [18, 17, 16, 22, 20, 24, 25],
    "anti-cheat": [12, 14, 16, 18, 20, 30, 43],
    social: [8, 9, 10, 9, 9, 8, 8],
    onboarding: [10, 12, 12, 15, 18, 20, 22],
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getStoredReviews() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (error) {
      return [];
    }
  }

  function saveReviewAction(action) {
    const existing = getStoredReviews();
    existing.unshift({ ...action, savedAt: new Date().toISOString() });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 40)));
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
      taxonomy: clone(TAXONOMY),
    };
  }

  function getStoredRules() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RULES_STORAGE_KEY) || "null");
      return parsed || getDefaultRules();
    } catch (error) {
      return getDefaultRules();
    }
  }

  function saveRules(rules) {
    window.localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  }

  function withReviewOverrides(posts) {
    const actions = getStoredReviews();
    if (!actions.length) return posts;
    return posts.map((post) => {
      const latestAction = actions.find((item) => item.postId === post.id);
      if (!latestAction) return post;
      return {
        ...post,
        topic: latestAction.topic || post.topic,
        sentiment: latestAction.sentiment || post.sentiment,
        ignored: Boolean(latestAction.ignored),
        reviewNote: latestAction.note || "",
      };
    });
  }

  function randomizeData(posts, trends) {
    const offset = Math.floor(Date.now() / 60000) % 7;
    const mutatedPosts = posts.map((post, index) => {
      const wave = ((offset + index) % 5) - 2;
      return {
        ...post,
        score: Math.max(12, post.score + wave * 14),
        commentsCount: Math.max(3, post.commentsCount + wave * 9),
        impact: Math.max(0.25, Math.min(0.99, post.impact + wave * 0.015)),
      };
    });

    const mutatedTrends = Object.fromEntries(
      Object.entries(trends).map(([key, values], index) => {
        const wave = ((offset + index) % 4) - 1;
        return [key, values.map((value, idx) => Math.max(4, value + wave * (idx > 4 ? 4 : 2)))];
      })
    );

    return { posts: mutatedPosts, trends: mutatedTrends };
  }

  function matchesKeyword(text, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }

  function classifyContentRisk(text) {
    const lower = String(text || "").toLowerCase();
    const rules = getStoredRules();
    if (rules.risk.red.some((word) => matchesKeyword(lower, word.toLowerCase()))) return "red";
    if (rules.risk.orange.some((word) => matchesKeyword(lower, word.toLowerCase()))) return "orange";
    return "green";
  }

  function classifySentiment(text) {
    const raw = String(text || "");
    const lower = raw.toLowerCase();
    const rules = getStoredRules();
    if (
      rules.sentiment.negativePhrases.some((phrase) =>
        phrase === "!!!" ? /!{3,}/.test(raw) : matchesKeyword(raw, phrase)
      )
    ) {
      return "negative";
    }
    if (rules.sentiment.positive.some((word) => matchesKeyword(lower, word.toLowerCase()))) {
      return "positive";
    }
    return "neutral";
  }

  function riskPriority(level) {
    return { red: 3, orange: 2, green: 1 }[level] || 1;
  }

  function formatRiskLabel(level) {
    const labels = (window.GameFeedbackUIConfig && window.GameFeedbackUIConfig.riskPalette) || {};
    return {
      red: labels.redLabel || "红色",
      orange: labels.orangeLabel || "橙色",
      green: labels.greenLabel || "绿色",
    }[level] || "绿色";
  }

  function riskCopy(level) {
    return {
      red: "需立即介入",
      orange: "重点观察",
      green: "常规收集",
    }[level] || "常规收集";
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function topicLabel(key) {
    const taxonomy = getStoredRules().taxonomy || TAXONOMY;
    const found = taxonomy.find((item) => item.key === key);
    if (found) return found.label;
    return key === "other" ? "其他" : key;
  }

  function summarizeRootCause(topicKey) {
    const variants = {
      monetization: "玩家集中抱怨定价、返利和付费价值感。",
      matchmaking: "玩家主要不满匹配不公平和对局质量下降。",
      server: "高峰时段的 Lag 和断线反馈正在聚集。",
      balance: "玩家认为版本调整过猛，常用套路被明显压缩。",
      "anti-cheat": "玩家不信任竞技环境，希望看到更快的处罚动作。",
      onboarding: "新手玩家前期理解成本较高，容易流失。",
      economy: "资源获取和消耗节奏存在争议，影响长期养成体验。",
      bug: "Bug 与稳定性问题反复出现，影响日常游玩体验。",
    };
    return variants[topicKey] || `${topicLabel(topicKey)} 相关负面反馈正在聚集。`;
  }

  function suggestAction(topicKey, riskLevel, volume) {
    const urgency = riskLevel === "red" ? "立即" : riskLevel === "orange" ? "今天" : "本周内";
    const playbooks = {
      monetization: `${urgency}统一定价、返利和补偿口径。`,
      matchmaking: `${urgency}复核匹配质量，并准备对外说明。`,
      server: `${urgency}确认容量和重连稳定性。`,
      balance: `${urgency}汇总争议改动，判断是热修还是继续观察。`,
      "anti-cheat": `${urgency}给出可见的处罚案例，恢复玩家信任。`,
      onboarding: `${urgency}补充新手引导或 FAQ。`,
      economy: `${urgency}复核资源投放与消耗曲线。`,
      bug: `${urgency}确认复现路径并同步修复进度。`,
    };
    return playbooks[topicKey] || `${urgency}复核 ${volume} 条相关内容并确认后续动作。`;
  }

  function buildTopicInsights(posts, trends) {
    return TAXONOMY.map((topic) => {
      const topicPosts = posts.filter((post) => !post.ignored && post.topic === topic.key);
      const negativePosts = topicPosts.filter((post) => post.sentiment === "negative");
      const heat = topicPosts.reduce((sum, post) => sum + post.score + post.commentsCount * 1.2, 0);
      const trend = trends[topic.key] || [0, 0, 0, 0, 0, 0, 0];
      const latest = trend[trend.length - 1] || 0;
      const baseline = Math.max(1, Math.round(trend.slice(0, 6).reduce((a, b) => a + b, 0) / 6));
      const growth = (latest - baseline) / baseline;
      const negativeShare = topicPosts.length ? negativePosts.length / topicPosts.length : 0;
      const riskLevel = topicPosts.reduce((current, post) => {
        return riskPriority(post.riskLevel) > riskPriority(current) ? post.riskLevel : current;
      }, "green");
      const riskScore = { red: 90, orange: 65, green: 25 }[riskLevel];
      const representativePost =
        negativePosts.sort((a, b) => b.score + b.commentsCount - (a.score + a.commentsCount))[0] ||
        topicPosts[0] ||
        null;

      return {
        key: topic.key,
        label: topic.label,
        aliases: topic.aliases,
        postCount: topicPosts.length,
        negativeCount: negativePosts.length,
        negativeShare,
        heat: Math.round(heat),
        growth,
        trend,
        riskScore,
        riskLevel,
        riskCopy: riskCopy(riskLevel),
        representativePost,
        rootCause: representativePost ? summarizeRootCause(topic.key) : "今天暂无明显抱怨聚类。",
        actionSuggestion: representativePost ? suggestAction(topic.key, riskLevel, negativePosts.length) : "继续观察。",
      };
    })
      .filter((item) => item.postCount > 0)
      .sort((a, b) => riskPriority(b.riskLevel) - riskPriority(a.riskLevel) || b.heat - a.heat);
  }

  function buildAlerts(insights) {
    return insights
      .filter(
        (item) =>
          item.riskLevel === "red" ||
          item.growth >= 0.35 ||
          (item.riskLevel === "orange" && item.negativeCount >= 2)
      )
      .slice(0, 5)
      .map((item, index) => ({
        id: `alert-${item.key}`,
        topic: item.label,
        riskLevel: item.riskLevel,
        title: `${item.label}${index === 0 ? " 风险正在扩大" : " 已触发预警"}`,
        reason:
          item.riskLevel === "red"
            ? `风险分 ${item.riskScore}，已进入红色区间。`
            : `负面量相对近期基线增长 ${Math.round(item.growth * 100)}%。`,
        owner: index % 2 === 0 ? "海外运营" : "Live Ops",
        channel: item.riskLevel === "red" ? "飞书 + 企业微信" : "看板 + 飞书",
        recommendation: item.actionSuggestion,
        postUrl: item.representativePost ? item.representativePost.url : "",
        createdAt: "今天 09:30",
      }));
  }

  function buildOverview(posts, insights, alerts) {
    const negativePosts = posts.filter((post) => !post.ignored && post.sentiment === "negative");
    const totalHeat = posts.reduce((sum, post) => sum + post.score + post.commentsCount, 0);
    const topTopic = insights[0];
    const riskScore = topTopic ? topTopic.riskScore : 25;
    const riskLevel = topTopic ? topTopic.riskLevel : "green";

    return {
      game: "Rise of Kingdoms",
      sources: ["r/RiseofKingdoms"],
      riskScore,
      riskLevel,
      riskCopy: riskCopy(riskLevel),
      riskChange: topTopic ? Math.max(2, Math.round(topTopic.growth * 20)) : 0,
      negativeVolume: negativePosts.length,
      discussionHeat: totalHeat,
      growthRate: topTopic ? topTopic.growth : 0,
      topTopic,
      alertsCount: alerts.length,
      executiveSummary: topTopic
        ? `${topTopic.label} 是今天最需要优先处理的风险点。`
        : "今天没有明显升温的系统性风险。",
      lastSyncAt: null,
    };
  }

  function buildDailyReport(overview, insights, posts, alerts) {
    const featuredPosts = posts
      .filter((post) => !post.ignored)
      .sort((a, b) => b.score + b.commentsCount - (a.score + a.commentsCount))
      .slice(0, 4);

    return {
      title: `${overview.game} 每日风险简报`,
      subtitle: `数据来源：${overview.sources.join(" / ")}`,
      executiveSummary:
        overview.riskLevel === "red"
          ? "玩家舆情已进入高风险状态，需要跨团队介入。"
          : overview.riskLevel === "orange"
            ? "风险正在升温，今天应重点处理。"
            : "整体风险可控，但头部问题仍需持续观察。",
      executiveDetail: overview.topTopic
        ? `${overview.topTopic.label} 当前风险分为 ${overview.topTopic.riskScore}。${overview.topTopic.rootCause}`
        : overview.executiveSummary,
      metrics: [
        { label: "整体风险", value: overview.riskScore, hint: formatRiskLabel(overview.riskLevel) },
        { label: "负面内容", value: overview.negativeVolume, hint: "负向帖子 / 评论数" },
        { label: "预警数", value: overview.alertsCount, hint: "高风险或升温问题" },
        { label: "讨论热度", value: overview.discussionHeat, hint: "点赞 + 评论" },
      ],
      topTopics: insights.slice(0, 3),
      actions: alerts.map((alert) => ({
        title: `${alert.topic} - ${alert.owner}`,
        body: `${alert.reason} ${alert.recommendation}`,
      })),
      featuredPosts,
    };
  }

  function buildReviewQueue(posts, insights) {
    return posts
      .filter((post) => post.sentiment === "negative" || post.impact > 0.7)
      .sort((a, b) => b.impact - a.impact)
      .map((post) => {
        const topicInsight = insights.find((item) => item.key === post.topic);
        return {
          ...post,
          suggestedRisk: topicInsight ? topicInsight.riskLevel : "green",
        };
      });
  }

  function getDataset() {
    const randomized = randomizeData(clone(BASE_POSTS), clone(BASE_TRENDS));
    const posts = withReviewOverrides(randomized.posts).map((post) => {
      const riskLevel = classifyContentRisk(`${post.title} ${post.body}`);
      return {
        ...post,
        sentiment: classifySentiment(`${post.title} ${post.body}`),
        riskLevel,
        riskCopy: riskCopy(riskLevel),
      };
    });
    const insights = buildTopicInsights(posts, randomized.trends);
    const alerts = buildAlerts(insights);
    const overview = buildOverview(posts, insights, alerts);
    const report = buildDailyReport(overview, insights, posts, alerts);
    return {
      overview,
      posts,
      insights,
      alerts,
      report,
      reviewQueue: buildReviewQueue(posts, insights),
      taxonomy: TAXONOMY,
      trends: randomized.trends,
      reviewActions: getStoredReviews(),
      rules: getStoredRules(),
    };
  }

  function mockFetch(path, params = {}) {
    const data = getDataset();
    switch (path) {
      case "/api/dashboard/overview":
        return Promise.resolve(data.overview);
      case "/api/issues":
        return Promise.resolve(data.insights);
      case "/api/posts":
        return Promise.resolve(data.posts);
      case "/api/reports/daily":
        return Promise.resolve(data.report);
      case "/api/review-queue":
        return Promise.resolve(data.reviewQueue);
      case "/api/labels/review":
        saveReviewAction(params);
        return Promise.resolve({ ok: true });
      case "/api/alerts/test":
        return Promise.resolve({ ok: true, message: "模拟告警已发送到飞书 / 企业微信。" });
      case "/api/admin/sync":
        return Promise.resolve({
          ok: true,
          result: { syncedAt: new Date().toISOString(), ingested: BASE_POSTS.length },
        });
      case "/api/alerts":
        return Promise.resolve(data.alerts);
      case "/api/rules":
        if (params && params.__method === "POST") {
          saveRules(params.payload);
          return Promise.resolve({ ok: true, rules: params.payload });
        }
        return Promise.resolve(data.rules);
      default:
        return Promise.reject(new Error(`Unknown mock path: ${path}`));
    }
  }

  async function realFetch(path, params = {}, method = "GET") {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    if (method === "GET") {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, value);
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    return response.json();
  }

  async function fetchApi(path, params = {}, method = "GET") {
    try {
      return await realFetch(path, params, method);
    } catch (error) {
      if (window.location.protocol === "file:") {
        return mockFetch(path, method === "POST" ? { __method: "POST", payload: params } : params);
      }
      throw error;
    }
  }

  function renderTrendBars(values) {
    return values
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

  window.GameFeedbackMonitor = {
    getDataset,
    mockFetch,
    fetchApi,
    topicLabel,
    formatNumber,
    formatPercent,
    formatRiskLabel,
    renderTrendBars,
    riskBadgeClass,
    sentimentLabel,
    relativeDate,
    formatDateTime(value) {
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
    },
    getDefaultRules,
  };
})();
