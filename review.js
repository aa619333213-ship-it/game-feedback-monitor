(function () {
  const App = window.GameFeedbackMonitor;
  if (window.applyGameFeedbackBranding) {
    window.applyGameFeedbackBranding();
  }

  const els = {
    reviewStats: document.getElementById("review-stats"),
    reviewList: document.getElementById("review-list"),
    reviewHistory: document.getElementById("review-history"),
    rulesForm: document.getElementById("rules-form"),
    rulesRed: document.getElementById("rules-red"),
    rulesOrange: document.getElementById("rules-orange"),
    rulesGreen: document.getElementById("rules-green"),
    rulesNegative: document.getElementById("rules-negative"),
    rulesPositive: document.getElementById("rules-positive"),
    taxonomyForm: document.getElementById("taxonomy-form"),
    gameSwitcher: document.getElementById("review-game-switcher"),
  };

  async function init() {
    renderGameSwitcher(App.fetchGameCatalog ? await App.fetchGameCatalog() : App.getGameCatalog());
    updateNavLinks();
    await renderPage();
    bindRuleForm();
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

  async function renderPage() {
    const [queuePayload, rules] = await Promise.all([
      App.fetchApi("/api/review-queue"),
      App.fetchApi("/api/rules"),
    ]);
    const queue = Array.isArray(queuePayload && queuePayload.items) ? queuePayload.items : [];
    const taxonomy = Array.isArray(rules.taxonomy) ? rules.taxonomy : [];
    const reviewHistory = Array.isArray(queuePayload && queuePayload.reviewActions) ? queuePayload.reviewActions : [];

    renderRuleForm(rules);
    App.setTaxonomyCache(taxonomy);
    renderTaxonomyForm(taxonomy);

    els.reviewStats.textContent = `${queue.length} 条内容待复核`;
    els.reviewList.innerHTML = queue
      .map(
        (post) => `
      <article class="review-card">
        <div class="review-head">
          <div>
            <div class="post-title-row">
              <span class="topic-chip">${App.topicLabel(post.topic)}</span>
              <span class="chip sentiment-${post.sentiment}">${App.sentimentLabel(post.sentiment)}</span>
              <span class="${App.riskBadgeClass(post.suggestedRisk || post.riskLevel || "green")}">${App.formatRiskLabel(post.suggestedRisk || post.riskLevel || "green")}</span>
            </div>
            <div class="post-title">${post.title}</div>
          </div>
          <div class="review-meta">${App.relativeDate(post.createdAt)}</div>
        </div>
        <p class="post-excerpt">${post.body}</p>
        <form class="review-form" data-post-id="${post.id}">
          <label>主题
            <select name="topic">
              ${taxonomy
                .map(
                  (item) =>
                    `<option value="${item.key}" ${item.key === post.topic ? "selected" : ""}>${item.label}</option>`
                )
                .join("")}
            </select>
          </label>
          <label>情绪
            <select name="sentiment">
              <option value="negative" ${post.sentiment === "negative" ? "selected" : ""}>负向</option>
              <option value="neutral" ${post.sentiment === "neutral" ? "selected" : ""}>中性</option>
              <option value="positive" ${post.sentiment === "positive" ? "selected" : ""}>正向</option>
            </select>
          </label>
          <label>备注
            <textarea name="note" rows="3" placeholder="例如：这条更应该归到平衡，而不是付费。"></textarea>
          </label>
          <label><input type="checkbox" name="ignored" /> 标记为误报</label>
          <button class="button button-primary" type="submit">保存校正</button>
        </form>
      </article>`
      )
      .join("");

    els.reviewHistory.innerHTML = reviewHistory.length
      ? reviewHistory
          .map(
            (action) => `
      <div class="history-item">
        <strong>${action.postId || "review"}</strong>
        <p>主题 -> ${App.topicLabel(action.corrected_topic_key || action.topic)} | 情绪 -> ${App.sentimentLabel(action.corrected_sentiment || action.sentiment)}${action.ignored ? " | 已忽略" : ""}</p>
        <p>${action.note || "无备注"}</p>
      </div>`
          )
          .join("")
      : `<div class="empty-state">还没有人工校正记录。</div>`;

    bindReviewForms();
  }

  function renderRuleForm(rules) {
    els.rulesRed.value = (rules.risk.red || []).join(", ");
    els.rulesOrange.value = (rules.risk.orange || []).join(", ");
    els.rulesGreen.value = (rules.risk.green || []).join(", ");
    els.rulesNegative.value = (rules.sentiment.negativePhrases || []).join(", ");
    els.rulesPositive.value = (rules.sentiment.positive || []).join(", ");
  }

  function renderTaxonomyForm(taxonomy) {
    els.taxonomyForm.innerHTML = taxonomy
      .map(
        (item) => `
      <label>
        ${item.label}
        <textarea rows="3" data-taxonomy-key="${item.key}" data-taxonomy-label="${item.label}" placeholder="keyword 1, keyword 2">${(item.aliases || []).join(", ")}</textarea>
      </label>`
      )
      .join("");
  }

  function parseList(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function collectTaxonomyForm() {
    return Array.from(els.taxonomyForm.querySelectorAll("textarea[data-taxonomy-key]")).map((field) => ({
      key: field.dataset.taxonomyKey,
      label: field.dataset.taxonomyLabel || field.dataset.taxonomyKey,
      aliases: parseList(field.value),
    }));
  }

  function bindRuleForm() {
    els.rulesForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = {
        risk: {
          red: parseList(els.rulesRed.value),
          orange: parseList(els.rulesOrange.value),
          green: parseList(els.rulesGreen.value),
        },
        sentiment: {
          negativePhrases: parseList(els.rulesNegative.value),
          positive: parseList(els.rulesPositive.value),
        },
        taxonomy: collectTaxonomyForm(),
      };

      await App.fetchApi("/api/rules", payload, "POST");
      window.alert("规则已保存，首页和报告页会立刻使用新规则。");
      await renderPage();
    });
  }

  function bindReviewForms() {
    document.querySelectorAll(".review-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        await App.fetchApi(
          "/api/labels/review",
          {
            postId: form.dataset.postId,
            topic: formData.get("topic"),
            sentiment: formData.get("sentiment"),
            note: formData.get("note"),
            ignored: formData.get("ignored") === "on",
          },
          "POST"
        );
        window.alert("校正已保存，结果会重新计算。");
        await renderPage();
      });
    });
  }

  init();
})();
