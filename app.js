(function () {
  const App = window.GameFeedbackMonitor;
  if (window.applyGameFeedbackBranding) {
    window.applyGameFeedbackBranding();
  }

  const state = {
    topic: "all",
    sentiment: "all",
    risk: "all",
    contentType: "all",
    sort: "time",
    page: 1,
    pageSize: 10,
    currentIssues: [],
    expandedIssueQuotes: {},
    expandedIssueRelated: {},
    issueRelatedCache: {},
    showAllIssues: false,
  };

  const els = {
    riskCard: document.getElementById("risk-card"),
    riskWeather: document.getElementById("risk-weather"),
    gameName: document.getElementById("game-name"),
    sourceSummary: document.getElementById("source-summary"),
    riskScore: document.getElementById("risk-score"),
    riskChange: document.getElementById("risk-change"),
    riskPanelTitle: document.getElementById("risk-panel-title"),
    riskNeedle: document.getElementById("risk-needle"),
    statRiskScore: document.getElementById("stat-risk-score"),
    statRiskCopy: document.getElementById("stat-risk-copy"),
    statChangeScore: document.getElementById("stat-change-score"),
    statChangeIcon: document.getElementById("stat-change-icon"),
    statPostCount: document.getElementById("stat-post-count"),
    statAlertCount: document.getElementById("stat-alert-count"),
    statAlertCopy: document.getElementById("stat-alert-copy"),
    headlineSummary: document.getElementById("headline-summary"),
    alertSummary: document.getElementById("alert-summary"),
    issueList: document.getElementById("issue-list"),
    allIssueList: document.getElementById("all-issue-list"),
    allIssuesSection: document.getElementById("all-issues-section"),
    allIssuesToggle: document.getElementById("all-issues-toggle"),
    topicFilter: document.getElementById("topic-filter"),
    sentimentFilter: document.getElementById("sentiment-filter"),
    riskFilter: document.getElementById("risk-filter"),
    contentTypeFilter: document.getElementById("content-type-filter"),
    sortFilter: document.getElementById("sort-filter"),
    postStream: document.getElementById("post-stream"),
    postPagination: document.getElementById("post-pagination"),
    refreshButton: document.getElementById("refresh-button"),
    testAlertButton: document.getElementById("test-alert-button"),
  };

  async function init() {
    bindEvents();
    try {
      await renderAll();
    } catch (error) {
      renderLoadError(error);
    }
  }

  function bindEvents() {
    els.topicFilter.addEventListener("change", onFilterChange("topic"));
    els.sentimentFilter.addEventListener("change", onFilterChange("sentiment"));
    els.riskFilter.addEventListener("change", onFilterChange("risk"));
    els.contentTypeFilter.addEventListener("change", onFilterChange("contentType"));
    els.sortFilter.addEventListener("change", onFilterChange("sort"));
    els.issueList.addEventListener("click", onIssueListClick);
    if (els.allIssueList) {
      els.allIssueList.addEventListener("click", onIssueListClick);
    }
    if (els.allIssuesToggle) {
      els.allIssuesToggle.addEventListener("click", () => {
        state.showAllIssues = !state.showAllIssues;
        renderIssues(state.currentIssues);
      });
    }

    els.refreshButton.addEventListener("click", async () => {
      els.refreshButton.disabled = true;
      els.refreshButton.querySelector("span:last-child").textContent = "正在同步 Reddit 实时数据";
      try {
        const syncResult = await App.fetchApi("/api/admin/sync", {}, "POST");
        if (syncResult && syncResult.ok) {
          window.location.reload();
          return;
        }
        throw new Error("sync failed");
      } catch (error) {
        renderLoadError(error);
      } finally {
        els.refreshButton.disabled = false;
        els.refreshButton.querySelector("span:last-child").textContent = "刷新实时数据";
      }
    });

    els.testAlertButton.addEventListener("click", async () => {
      try {
        const result = await App.fetchApi("/api/alerts/test", {}, "POST");
        window.alert(result.message);
      } catch (error) {
        window.alert(`测试告警失败：${error.message}`);
      }
    });
  }

  async function onIssueListClick(event) {
    const actionButton = event.target.closest("[data-issue-action]");
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.issueAction;
    const topicKey = actionButton.dataset.topicKey;
    if (!topicKey) {
      return;
    }

    if (action === "toggle-quote") {
      state.expandedIssueQuotes[topicKey] = !state.expandedIssueQuotes[topicKey];
      renderIssues(state.currentIssues);
      return;
    }

    if (action === "toggle-related") {
      if (state.expandedIssueRelated[topicKey]) {
        state.expandedIssueRelated[topicKey] = false;
        renderIssues(state.currentIssues);
        return;
      }

      if (!state.issueRelatedCache[topicKey]) {
        actionButton.disabled = true;
        actionButton.textContent = "正在加载...";
        try {
          const issue = state.currentIssues.find((item) => item.key === topicKey);
          const size = Math.min(50, Math.max(10, (issue && issue.occurrenceCount) || 10));
          const query = new URLSearchParams({
            topic: topicKey,
            sentiment: "all",
            risk: "all",
            contentType: "all",
            sort: "heat",
            page: "1",
            pageSize: String(size),
          });
          const response = await App.fetchApi(`/api/posts?${query.toString()}`);
          state.issueRelatedCache[topicKey] = response && Array.isArray(response.items) ? response.items : [];
        } catch (error) {
          window.alert(`加载同主题帖子失败：${error.message}`);
          actionButton.disabled = false;
          actionButton.textContent = "查看其他帖子";
          return;
        }
      }

      state.expandedIssueRelated[topicKey] = true;
      renderIssues(state.currentIssues);
    }
  }

  function onFilterChange(key) {
    return async (event) => {
      state[key] = event.target.value;
      state.page = 1;
      await safeRenderPosts();
    };
  }

  async function renderAll() {
    const response = await App.fetchApi("/api/dashboard");
    renderOverview(response.overview, response.issues, response.alerts);
    renderIssues(response.issues);
    populateTopicFilter(response.taxonomy);
    await safeRenderPosts();
  }

  async function safeRenderPosts() {
    try {
      const query = new URLSearchParams({
        topic: state.topic,
        sentiment: state.sentiment,
        risk: state.risk,
        contentType: state.contentType,
        sort: state.sort,
        page: String(state.page),
        pageSize: String(state.pageSize),
      });
      const posts = await App.fetchApi(`/api/posts?${query.toString()}`);
      renderPosts(posts);
    } catch (error) {
      renderLoadError(error);
    }
  }

  function renderOverview(overview, issues, alerts) {
    const sourceList = Array.isArray(overview.sources)
      ? overview.sources
      : overview.sources
        ? [overview.sources]
        : [];
    const weatherLevel = overview.weatherLevel || deriveWeatherLevel(overview.riskScore);
    const weatherLabel = displayWeatherLabel(overview.weatherLabel, weatherLevel);
    const scoreDelta = typeof overview.riskChange === "number" ? overview.riskChange : 0;
    const needleAngle =
      typeof overview.needleAngle === "number"
        ? overview.needleAngle
        : -90 + Math.max(0, Math.min(100, overview.riskScore || 0)) * 1.8;
    const totalPosts = (overview.redRiskCount || 0) + (overview.orangeRiskCount || 0) + (overview.greenRiskCount || 0);

    els.gameName.textContent = "万国觉醒";
    els.sourceSummary.textContent = sourceList.join(" + ");
    els.riskPanelTitle.textContent = `风险气象（评分: ${overview.riskScore} - ${weatherLabel}）`;
    els.riskScore.textContent = overview.riskScore;
    els.riskChange.textContent = `${scoreDelta >= 0 ? "+" : ""}${Math.abs(scoreDelta)} ${scoreDelta <= 0 ? "趋势回稳" : "风险走高"}`;
    els.statRiskScore.textContent = Math.max(0, 100 - (overview.riskScore || 0));
    els.statRiskCopy.textContent = weatherLevel === "green" ? "良好" : weatherLevel === "orange" ? "观察中" : "高风险";
    els.statRiskCopy.className = weatherLevel === "green" ? "radar-stat-positive" : weatherLevel === "orange" ? "radar-stat-warning" : "radar-stat-danger";
    els.statChangeScore.textContent = `${Math.abs(Math.round((overview.growthRate || 0) * 100))}%`;
    els.statChangeIcon.textContent = (overview.growthRate || 0) <= 0 ? "trending_up" : "trending_down";
    els.statChangeIcon.className = `material-symbols-outlined ${(overview.growthRate || 0) <= 0 ? "radar-stat-positive" : "radar-stat-danger"}`;
    els.statPostCount.textContent = App.formatNumber(totalPosts);
    els.statAlertCount.textContent = overview.alertsCount || 0;
    els.statAlertCopy.textContent = (overview.alertsCount || 0) > 0 ? "需处理" : "已稳定";
    els.statAlertCopy.className = (overview.alertsCount || 0) > 0 ? "radar-stat-danger" : "radar-stat-positive";
    els.headlineSummary.innerHTML = buildHeadlineSummary(overview, issues);

    if (els.riskNeedle) {
      els.riskNeedle.style.transform = `translateX(-50%) rotate(${needleAngle}deg)`;
    }
    renderWeatherFx(weatherLevel);
    renderAlertSummary(issues, alerts);
  }

  function buildHeadlineSummary(overview, issues) {
    const top = overview.topTopic;
    if (!top) {
      return "过去 72 小时内暂未观察到明显抬头的系统性风险。";
    }

    const label = topicLabel(top.key || top.label);
    const summary = translateCopy(top.rootCause || overview.executiveSummary || "");
    return `<span class="radar-highlight">${label}</span> 是过去 72 小时内最大的实时风险来源。${summary}`;
  }

  function renderAlertSummary(issues, alerts) {
    const topIssues = (issues || []).slice(0, 3);
    const totalHeat = topIssues.reduce((sum, item) => sum + (item.heat || 0), 0) || 1;
    const rows = topIssues.map((item) => {
      const width = Math.max(12, Math.round(((item.heat || 0) / totalHeat) * 100));
      const levelClass = item.riskLevel === "red" ? "red" : item.riskLevel === "orange" ? "orange" : "blue";
      const issueCount = (item.occurrenceCount || item.negativeCount || 0);
      return `
        <div class="radar-alert-row">
          <div class="radar-alert-track">
            <div class="radar-alert-fill ${levelClass}" style="width:${width}%"></div>
          </div>
          <span class="radar-alert-label">${topicLabel(item.key || item.label)}</span>
          <span class="radar-alert-count">${issueCount} 条</span>
          <strong>${width}%</strong>
        </div>
      `;
    });

    if (!rows.length) {
      els.alertSummary.innerHTML = `<div class="empty-state">当前没有实时预警。</div>`;
      return;
    }

    els.alertSummary.innerHTML = rows.join("");
  }

  function renderIssues(issues) {
    state.currentIssues = Array.isArray(issues) ? issues : [];
    const topIssues = (issues || []).slice(0, 4);
    els.issueList.innerHTML = topIssues.length
      ? topIssues.map((item, index) => renderIssueCard(item, index)).join("")
      : `<div class="empty-state">当前没有可展示的问题主题。</div>`;

    if (els.allIssuesSection && els.allIssueList && els.allIssuesToggle) {
      const hasMoreIssues = state.currentIssues.length > 4;
      els.allIssuesToggle.hidden = !hasMoreIssues;
      els.allIssuesToggle.textContent = state.showAllIssues ? "收起完整榜单" : "查看全部榜单";
      els.allIssuesSection.hidden = !state.showAllIssues || !state.currentIssues.length;
      if (state.showAllIssues && state.currentIssues.length) {
        const remainingIssues = state.currentIssues.slice(4);
        els.allIssueList.innerHTML = remainingIssues
          .map((item, index) => renderIssueCard(item, index + 4))
          .join("");
      } else {
        els.allIssueList.innerHTML = "";
      }
    }
  }

  function renderIssueCard(item, index) {
    const priorityText = issuePriority(item, index);
    const accentClass = item.riskLevel === "red" ? "red" : item.riskLevel === "orange" ? "orange" : index === 3 ? "purple" : "blue";
    const change = Math.round((item.growth || 0) * 100);
    const quoteExpanded = !!state.expandedIssueQuotes[item.key];
    const quote = representativeQuote(item.representativePost, quoteExpanded);
    const tags = buildTags(item);
    const actionLabel = translateCopy(item.actionSuggestion || "");
    const postUrl = representativePostUrl(item.representativePost);
    const postLink = postUrl
      ? `<a class="radar-source-link" href="${postUrl}" target="_blank" rel="noreferrer">查看原帖</a>`
      : "";
    const issueCount = item.occurrenceCount || 0;
    const remainingCount = Math.max(0, issueCount - 1);
    const relatedExpanded = !!state.expandedIssueRelated[item.key];
    const quoteToggle = item.representativePost && representativeText(item.representativePost).length > 72
      ? `<button class="radar-inline-btn" type="button" data-issue-action="toggle-quote" data-topic-key="${item.key}">${quoteExpanded ? "收起全文" : "查看全文"}</button>`
      : "";
    const relatedToggle = remainingCount > 0
      ? `<button class="radar-inline-btn" type="button" data-issue-action="toggle-related" data-topic-key="${item.key}">${relatedExpanded ? "收起其他帖子" : `查看其余 ${remainingCount} 条`}</button>`
      : "";
    const relatedSection = relatedExpanded ? renderRelatedIssuePosts(item) : "";

    return `
      <article class="radar-issue-card ${accentClass}">
        <div class="radar-issue-top">
          <div>
            <span class="radar-issue-rank">TOP ${index + 1}</span>
            <h4>${topicLabel(item.key)} (${item.label})</h4>
          </div>
          <span class="radar-priority-badge ${accentClass}">${priorityText}</span>
        </div>
        <p class="radar-issue-desc">${translateCopy(item.rootCause || "")}</p>
        <div class="radar-issue-stats">
          <div class="radar-mini-stat">
            <span>风险占比</span>
            <strong>${App.formatPercent(item.riskShare || item.negativeShare || 0)}</strong>
          </div>
          <div class="radar-mini-stat">
            <span>环比变化</span>
            <strong class="${change > 0 ? "radar-text-danger" : "radar-text-positive"}">${change > 0 ? "+" : ""}${change}%</strong>
          </div>
        </div>
        <div class="radar-quote-box">
          <span class="material-symbols-outlined">chat_bubble</span>
          <p>${quote}</p>
        </div>
        <div class="radar-inline-actions">
          ${quoteToggle}
          ${relatedToggle}
        </div>
        ${postLink}
        ${relatedSection}
        <div class="radar-tag-row">${tags}</div>
        <button class="radar-action-btn ${accentClass}" type="button">${actionLabel}</button>
      </article>
    `;
  }

  function issuePriority(item, index) {
    if (item.riskLevel === "red") return "P0 紧急处理";
    if (item.riskLevel === "orange") return index === 1 ? "P1 高级监控" : "P1 重点观察";
    return "P2 持续观察";
  }

  function representativeText(post) {
    return String(post && (post.body || post.title) || "").replace(/\s+/g, " ").trim();
  }

  function representativeQuote(post, expanded = false) {
    if (!post) {
      return "“当前没有代表性玩家反馈。”";
    }
    const text = representativeText(post);
    const excerpt = !expanded && text.length > 72 ? `${text.slice(0, 72)}...` : text;
    return `“${excerpt || "当前没有代表性玩家反馈。"}”`;
  }

  function renderRelatedIssuePosts(item) {
    const relatedPosts = (state.issueRelatedCache[item.key] || []).filter((post) => post.id !== (item.representativePost && item.representativePost.external_id));
    if (!relatedPosts.length) {
      return `<div class="radar-related-list empty">当前没有更多同主题帖子。</div>`;
    }

    const rows = relatedPosts.map((post) => {
      const body = String(post.body || post.title || "").replace(/\s+/g, " ").trim();
      const excerpt = body.length > 120 ? `${body.slice(0, 120)}...` : body;
      return `
        <article class="radar-related-item">
          <div class="radar-related-head">
            <strong>${post.postType === "submission" ? "帖子" : "评论"}</strong>
            <span>${post.score || 0} 赞 / ${post.commentsCount || 0} 评论</span>
          </div>
          <h5>${post.originalTitle || post.title || "未命名帖子"}</h5>
          <p>${excerpt || "当前没有可显示的正文。"} </p>
          <a href="${post.url}" target="_blank" rel="noreferrer">打开这条内容</a>
        </article>
      `;
    }).join("");

    return `
      <section class="radar-related-list">
        <div class="radar-related-title">同主题其余 ${relatedPosts.length} 条</div>
        <div class="radar-related-grid">${rows}</div>
      </section>
    `;
  }

  function representativePostUrl(post) {
    if (!post) return "";
    return post.post_url || post.url || "";
  }

  function buildTags(item) {
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    const post = item.representativePost || {};
    const body = `${post.title || ""} ${post.body || ""}`.toLowerCase();
    const matches = aliases.filter((alias) => body.includes(String(alias).toLowerCase())).slice(0, 2);
    const tags = matches.length ? matches : aliases.slice(0, 2);
    return tags.map((tag) => `<span class="radar-tag">#${tag}</span>`).join("");
  }

  function populateTopicFilter(taxonomy) {
    const currentValue = els.topicFilter.value || state.topic;
    els.topicFilter.innerHTML =
      `<option value="all">全部系统</option>` +
      (taxonomy || []).map((item) => `<option value="${item.key}">${topicLabel(item.key || item.label)}</option>`).join("");
    els.topicFilter.value = currentValue;
  }

  function renderPosts(payload) {
    const posts = payload && Array.isArray(payload.items) ? payload.items : [];
    els.postStream.innerHTML = posts.length
      ? posts.map((post) => renderPostCard(post)).join("")
      : `<div class="empty-state">当前筛选条件下没有内容。</div>`;
    renderPagination(payload);
  }

  function renderPagination(payload) {
    const page = payload && payload.page ? payload.page : 1;
    const pageSize = payload && payload.pageSize ? payload.pageSize : state.pageSize;
    const total = payload && typeof payload.total === "number" ? payload.total : 0;
    const totalPages = payload && payload.totalPages ? payload.totalPages : 1;
    const start = total ? (page - 1) * pageSize + 1 : 0;
    const end = total ? Math.min(page * pageSize, total) : 0;

    els.postPagination.innerHTML = `
      <div class="pagination-status">显示 ${start}-${end} / ${total} 条，近 72 小时内容</div>
      <div class="pagination-actions">
        <button class="button button-secondary" data-page-action="prev" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <span class="pagination-status">第 ${page} / ${Math.max(1, totalPages)} 页</span>
        <button class="button button-secondary" data-page-action="next" ${page >= totalPages ? "disabled" : ""}>下一页</button>
      </div>
    `;

    const prevButton = els.postPagination.querySelector('[data-page-action="prev"]');
    const nextButton = els.postPagination.querySelector('[data-page-action="next"]');

    if (prevButton) {
      prevButton.addEventListener("click", async () => {
        if (state.page <= 1) return;
        state.page -= 1;
        await safeRenderPosts();
      });
    }

    if (nextButton) {
      nextButton.addEventListener("click", async () => {
        if (state.page >= totalPages) return;
        state.page += 1;
        await safeRenderPosts();
      });
    }
  }

  function renderPostCard(post) {
    const typeLabel = post.postType === "submission" ? "帖子" : "评论";
    const topic = topicLabel(post.topic);
    return `
      <article class="post-card">
        <div class="post-head">
          <div>
            <div class="post-title-row">
              <span class="topic-chip">${topic}</span>
              <span class="chip">${typeLabel}</span>
              <span class="chip sentiment-${post.sentiment}">${App.sentimentLabel(post.sentiment)}</span>
              <span class="${App.riskBadgeClass(post.riskLevel)}">${App.formatRiskLabel(post.riskLevel)}</span>
            </div>
            <div class="post-title">${post.title}</div>
          </div>
          <div class="post-meta">${App.relativeDate(post.createdAt)}</div>
        </div>
        <p class="post-excerpt">${post.body || ""}</p>
        <div class="issue-summary">
          <div class="summary-block"><strong>处理等级</strong><span>${translateCopy(post.riskCopy || "")}</span></div>
          <div class="summary-block"><strong>根因摘要</strong><span>${translateCopy(post.rootCause || "")}</span></div>
          <div class="summary-block"><strong>建议动作</strong><span>${translateCopy(post.actionSuggestion || "")}</span></div>
        </div>
        <div class="post-meta">r/${post.subreddit} | 作者 ${post.author} | ${post.score} 赞 | ${post.commentsCount} 评论</div>
        <a class="post-link" href="${post.url}" target="_blank" rel="noreferrer">打开 Reddit 原帖</a>
      </article>
    `;
  }

  function deriveWeatherLevel(score) {
    if ((score || 0) > 80) return "green";
    if ((score || 0) >= 60) return "orange";
    return "red";
  }

  function displayWeatherLabel(rawLabel, level) {
    if (rawLabel === "sunny") return "晴朗";
    if (rawLabel === "cloudy") return "阴天";
    if (rawLabel === "rainy") return "雨天";
    return level === "green" ? "晴朗" : level === "orange" ? "阴天" : "雨天";
  }

  function topicLabel(key) {
    const labels = {
      matchmaking: "匹配",
      economy: "经济",
      monetization: "付费",
      event: "活动",
      progression: "进度",
      balance: "平衡",
      server: "服务器",
      bug: "漏洞",
      "anti-cheat": "反作弊",
      social: "社交",
      onboarding: "新手引导",
    };
    return labels[key] || key || "其他";
  }

  function translateCopy(text) {
    const source = String(text || "");
    const dictionary = {
      "Immediate Intervention Required": "需立即介入",
      "Close Observation Needed": "重点观察",
      "Routine Feedback Collection": "常规收集",
      "Routine Monitoring": "常规监测",
      "Close Risk Watch": "重点观察",
      "Bug is the biggest live risk source in the last 72 hours.": "漏洞是过去 72 小时内最大的实时风险来源。",
      "Broken flows and recurring defects are dragging trust down.": "漏洞与流程失效重复出现，正在侵蚀玩家信任。主要集中在系统异常、流程失灵与资源损失感知。",
      "Players feel progression is too grind-heavy or blocked by unclear requirements.": "后期成长线过长，玩家反馈肝度偏高，导致活跃用户在中期更容易流失。",
      "Players think the current patch compressed viable strategies and made the meta stale too quickly.": "当前版本的平衡调整压缩了可用策略，部分玩家认为环境固化过快。",
      "Players are angry about value perception, especially pricing and pity progression.": "玩家集中抱怨定价、返利和付费价值感。",
      "Complaints focus on unfair ranked matches, solo players facing stacked groups, and weak match quality.": "玩家主要不满匹配不公平，以及单排遭遇车队导致的对局体验下滑。",
      "Feedback points to lag, disconnects, and unstable reset-hour performance.": "高峰时段的 Lag、掉线和活动开启时的稳定性问题正在累积。",
      "Players do not trust competitive integrity and think visible cheaters stay active too long.": "玩家对竞技环境缺乏信任，认为明显作弊者处理太慢。",
      "New players are getting lost early and dropping before they understand core systems.": "新手玩家在早期阶段容易迷失，在理解核心系统前就流失。",
      "The grind-to-reward ratio feels off, especially when players compare daily effort to returns.": "玩家认为日常投入与回报失衡，养成收益感不足。",
      "Event pacing and rewards are under scrutiny, especially when expectations were raised by promotions.": "活动节奏与奖励正在被质疑，特别是在宣传抬高预期之后。",
      "Players feel social features are missing, clunky, or not rewarding enough.": "玩家觉得社交功能缺失、难用，或者反馈不足。",
      "Immediately communicate known issues and expected fix timing to reduce uncertainty.": "建议操作：立即修复并公示补偿",
      "Immediately clarify event value and timing expectations before dissatisfaction spreads further.": "建议操作：立即补充活动价值说明",
      "Immediately align on external messaging for pity, pricing, and compensation boundaries.": "建议操作：立即统一付费沟通口径",
      "Today isolate the biggest grind pain points and confirm whether progression gates should ease.": "建议操作：优化新手加速奖励",
      "Today summarize the most criticized changes and decide between hotfix or observation.": "建议操作：针对性微调数值权重",
      "Today review queue quality and reset tuning, then prepare a status update for players.": "建议操作：复核匹配参数并公告",
      "This cycle clarify event value and timing expectations before dissatisfaction spreads further.": "建议操作：补充活动价值说明",
      "This cycle identify the weakest social touchpoints and prioritize one near-term improvement.": "建议操作：补足社交引导反馈",
      "This cycle review daily reward pacing and confirm whether a short-term adjustment is needed.": "建议操作：复核资源投放节奏",
      "This cycle align on external messaging for pity, pricing, and compensation boundaries.": "建议操作：统一付费沟通口径",
      "This cycle review queue quality and reset tuning, then prepare a status update for players.": "建议操作：复核匹配参数并公告",
      "This cycle publish a starter guide or FAQ that closes the biggest early-game confusion gaps.": "建议操作：补充新手指南",
      "This cycle verify capacity and reconnect stability before the next activity peak.": "建议操作：验证容量与重连稳定性",
    };
    return dictionary[source] || source;
  }

  function renderWeatherFx(level) {
    if (!els.riskCard || !els.riskWeather) return;

    const mode = level === "green" ? "sunny" : level === "orange" ? "cloudy" : "rainy";
    els.riskCard.classList.remove("weather-sunny", "weather-cloudy", "weather-rainy");
    els.riskCard.classList.add(`weather-${mode}`);

    if (mode === "sunny") {
      els.riskWeather.innerHTML = `
        <span class="sun-orb"></span>
        <span class="sun-ray ray-1"></span>
        <span class="sun-ray ray-2"></span>
        <span class="sun-ray ray-3"></span>
        <span class="sun-glow glow-1"></span>
        <span class="sun-glow glow-2"></span>
      `;
      return;
    }

    if (mode === "cloudy") {
      els.riskWeather.innerHTML = `
        <span class="cloud cloud-1"></span>
        <span class="cloud cloud-2"></span>
        <span class="cloud cloud-3"></span>
      `;
      return;
    }

    els.riskWeather.innerHTML = `
      <span class="cloud cloud-1"></span>
      <span class="cloud cloud-2"></span>
      <span class="rain-drop drop-1"></span>
      <span class="rain-drop drop-2"></span>
      <span class="rain-drop drop-3"></span>
      <span class="rain-drop drop-4"></span>
      <span class="rain-drop drop-5"></span>
      <span class="rain-drop drop-6"></span>
    `;
  }

  function renderLoadError(error) {
    const message = error && error.message ? error.message : "未知错误";
    const html = `<div class="empty-state">实时接口异常：${message}</div>`;
    els.issueList.innerHTML = html;
    els.alertSummary.innerHTML = html;
    els.postStream.innerHTML = html;
    els.postPagination.innerHTML = "";
  }

  init();
})();
