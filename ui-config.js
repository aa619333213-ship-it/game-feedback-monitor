(function () {
  const uiConfig = {
    brand: {
      productName: "海外玩家反馈监控台",
      englishName: "Overseas Ops Radar",
      gameName: "王国纪元 / Rise of Kingdoms",
      gameKey: "rise-of-kingdoms",
      monitoringSummary:
        "聚焦 Reddit 玩家反馈，快速识别最不满的系统、扩散速度与当前运营风险。",
      sourcesLabel: "r/RiseofKingdoms",
    },
    copy: {
      dashboardTitle: "3 分钟看清今天最值得关注的玩家风险",
      dashboardSubtitle:
        "把风险分、讨论热度与代表帖子放在同一屏里，方便运营团队快速判断是否需要介入。",
      reportsTitle: "每日报告",
      reportsSubtitle:
        "把今天的 Reddit 玩家反馈整理成适合晨会、同步和汇报使用的日报。",
      reviewTitle: "人工矫正台",
      reviewSubtitle:
        "修正主题归类与判定规则，让看板口径更贴近你们的运营判断。",
    },
    theme: {
      bg: "#f6f1e8",
      bgAccent:
        "radial-gradient(circle at 14% 14%, rgba(79, 140, 255, 0.14), transparent 24%), radial-gradient(circle at 88% 10%, rgba(245, 158, 11, 0.12), transparent 22%), radial-gradient(circle at 74% 82%, rgba(16, 185, 129, 0.1), transparent 20%), linear-gradient(180deg, #fbf7f1 0%, #f6efe6 48%, #f2ebe1 100%)",
      surface: "rgba(255, 255, 255, 0.7)",
      surfaceStrong: "rgba(255, 255, 255, 0.92)",
      text: "#1d2736",
      muted: "#6a7688",
      line: "rgba(29, 39, 54, 0.1)",
      brand: "#3b82f6",
      brandDeep: "#1d4ed8",
      warning: "#f59e0b",
      danger: "#ef4444",
      success: "#10b981",
      yellow: "#eab308",
      shadow: "0 28px 70px rgba(72, 53, 25, 0.12)",
    },
    riskPalette: {
      greenLabel: "绿色",
      orangeLabel: "橙色",
      redLabel: "红色",
    },
  };

  function applyTheme(theme) {
    const root = document.documentElement;
    root.style.setProperty("--bg", theme.bg);
    root.style.setProperty("--bg-accent", theme.bgAccent);
    root.style.setProperty("--surface", theme.surface);
    root.style.setProperty("--surface-strong", theme.surfaceStrong);
    root.style.setProperty("--text", theme.text);
    root.style.setProperty("--muted", theme.muted);
    root.style.setProperty("--line", theme.line);
    root.style.setProperty("--brand", theme.brand);
    root.style.setProperty("--brand-deep", theme.brandDeep);
    root.style.setProperty("--warning", theme.warning);
    root.style.setProperty("--danger", theme.danger);
    root.style.setProperty("--success", theme.success);
    root.style.setProperty("--yellow", theme.yellow);
    root.style.setProperty("--shadow", theme.shadow);
  }

  function applyBranding() {
    applyTheme(uiConfig.theme);
    document.title = uiConfig.brand.productName;

    const gameName = document.getElementById("game-name");
    if (gameName) gameName.textContent = uiConfig.brand.gameName;

    const sourceSummary = document.getElementById("source-summary");
    if (sourceSummary) sourceSummary.textContent = uiConfig.brand.sourcesLabel;

    const page = document.body.dataset.page;

    if (page === "dashboard") {
      const eyebrow = document.querySelector(".sidebar .eyebrow");
      const h1 = document.querySelector(".sidebar h1");
      const sidebarCopy = document.querySelector(".sidebar-copy");
      const heroTitle = document.querySelector(".hero h2");
      const heroCopy = document.querySelector(".hero-copy");
      if (eyebrow) eyebrow.textContent = uiConfig.brand.englishName;
      if (h1) h1.textContent = uiConfig.brand.productName;
      if (sidebarCopy) sidebarCopy.textContent = uiConfig.brand.monitoringSummary;
      if (heroTitle) heroTitle.textContent = uiConfig.copy.dashboardTitle;
      if (heroCopy) heroCopy.textContent = uiConfig.copy.dashboardSubtitle;
    }

    if (page === "reports") {
      const h1 = document.querySelector(".sidebar h1");
      const sidebarCopy = document.querySelector(".sidebar-copy");
      if (h1) h1.textContent = uiConfig.copy.reportsTitle;
      if (sidebarCopy) sidebarCopy.textContent = uiConfig.copy.reportsSubtitle;
    }

    if (page === "review") {
      const h1 = document.querySelector(".sidebar h1");
      const sidebarCopy = document.querySelector(".sidebar-copy");
      if (h1) h1.textContent = uiConfig.copy.reviewTitle;
      if (sidebarCopy) sidebarCopy.textContent = uiConfig.copy.reviewSubtitle;
    }
  }

  window.GameFeedbackUIConfig = uiConfig;
  window.applyGameFeedbackBranding = applyBranding;
})();
