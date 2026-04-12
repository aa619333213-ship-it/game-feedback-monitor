(function () {
  const App = window.GameFeedbackMonitor;
  if (window.applyGameFeedbackBranding) {
    window.applyGameFeedbackBranding();
  }

  const els = {
    reportTitle: document.getElementById("report-title"),
    reportSubtitle: document.getElementById("report-subtitle"),
    executiveSummary: document.getElementById("executive-summary"),
    executiveDetail: document.getElementById("executive-detail"),
    reportMetrics: document.getElementById("report-metrics"),
    reportTopics: document.getElementById("report-topics"),
    recommendedActions: document.getElementById("recommended-actions"),
    featuredPosts: document.getElementById("featured-posts"),
    gameSwitcher: document.getElementById("reports-game-switcher"),
  };

  async function init() {
    renderGameSwitcher(App.getGameCatalog ? App.getGameCatalog() : []);
    updateNavLinks();
    const report = await App.fetchApi("/api/reports/daily");
    renderReport(report);
  }

  function renderGameSwitcher(games) {
    if (!els.gameSwitcher) return;
    const currentGame = App.getCurrentGameKey();
    els.gameSwitcher.innerHTML = (games || []).map((game) => `
      <a class="radar-game-card ${game.key === currentGame ? "is-active" : ""}" href="${App.buildPageHref("dashboard", game.key)}">
        <strong>${game.displayName || game.name}</strong>
        <p>${game.sourcesLabel || ""}</p>
        ${game.key === currentGame ? '<span class="radar-game-badge">当前</span>' : ""}
      </a>
    `).join("");
  }

  function updateNavLinks() {
    const currentGame = App.getCurrentGameKey();
    const links = Array.from(document.querySelectorAll(".nav-link"));
    if (links[0]) links[0].href = App.buildPageHref("dashboard", currentGame);
    if (links[1]) links[1].href = App.buildPageHref("reports", currentGame);
    if (links[2]) links[2].href = App.buildPageHref("review", currentGame);
  }

  function renderReport(report) {
    els.reportTitle.textContent = report.title;
    els.reportSubtitle.textContent = report.subtitle;
    els.executiveSummary.textContent = report.executiveSummary;
    els.executiveDetail.textContent = report.executiveDetail;

    els.reportMetrics.innerHTML = report.metrics
      .map(
        (item) =>
          `<div class="metric"><span>${item.label}</span><strong>${item.value}</strong><small>${item.hint}</small></div>`
      )
      .join("");

    els.reportTopics.innerHTML = report.topTopics
      .map(
        (item, index) => `
      <section class="issue-card">
        <div class="issue-head">
          <div>
            <div class="issue-title-row">
              <span class="${App.riskBadgeClass(item.riskLevel)}">${App.formatRiskLabel(item.riskLevel)}</span>
              <h4>${index + 1}. ${item.label}</h4>
            </div>
            <p class="summary-text">${item.rootCause}</p>
          </div>
          <strong>${item.riskScore}</strong>
        </div>
        <div class="summary-block"><strong>建议动作</strong><span>${item.actionSuggestion}</span></div>
      </section>`
      )
      .join("");

    els.recommendedActions.innerHTML = report.actions
      .map(
        (action) => `
      <div class="stack-item">
        <strong>${action.title}</strong>
        <p>${action.body}</p>
      </div>`
      )
      .join("");

    els.featuredPosts.innerHTML = report.featuredPosts
      .map(
        (post) => `
      <article class="post-card">
        <div class="post-title-row">
          <span class="topic-chip">${App.topicLabel(post.topic)}</span>
          <span class="chip sentiment-${post.sentiment}">${App.sentimentLabel(post.sentiment)}</span>
        </div>
        <div class="post-title">${post.title}</div>
        <p class="post-excerpt">${post.body}</p>
        <div class="post-meta">r/${post.subreddit} | ${post.score} 赞 | ${post.commentsCount} 评论</div>
        <a class="post-link" href="${post.url}" target="_blank" rel="noreferrer">打开原帖</a>
      </article>`
      )
      .join("");
  }

  init();
})();
