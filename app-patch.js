(function () {
  function setText(selector, text) {
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = text;
    }
  }

  function updateStatLabels() {
    const statPostCount = document.getElementById("stat-post-count");
    if (!statPostCount) return;

    if (statPostCount.previousElementSibling) {
      statPostCount.previousElementSibling.textContent = "帖子 / 评论";
    }

    if (statPostCount.nextElementSibling) {
      statPostCount.nextElementSibling.textContent = "过去72h";
    }
  }

  function updateSyncStatus(overview) {
    const syncStatus = document.getElementById("sync-status");
    if (!syncStatus || !window.GameFeedbackMonitor) return;

    const lastSync = overview && overview.lastSyncAt
      ? window.GameFeedbackMonitor.formatDateTime(overview.lastSyncAt)
      : "暂无";

    const contentTypeFilter = document.getElementById("content-type-filter");
    const viewLabel = contentTypeFilter && contentTypeFilter.value === "comment"
      ? "评论"
      : contentTypeFilter && contentTypeFilter.value === "all"
        ? "全部内容"
        : "帖子";

    syncStatus.textContent = `最近同步：${lastSync} · 当前视图：${viewLabel}`;
  }

  async function refreshOverviewStatus() {
    if (!window.GameFeedbackMonitor) return;
    try {
      const dashboard = await window.GameFeedbackMonitor.fetchApi("/api/dashboard");
      updateSyncStatus(dashboard && dashboard.overview ? dashboard.overview : null);
      updateStatLabels();
    } catch {}
  }

  function replaceRefreshButton() {
    const button = document.getElementById("refresh-button");
    if (!button || !window.GameFeedbackMonitor) return;

    const cleanButton = button.cloneNode(true);
    button.parentNode.replaceChild(cleanButton, button);

    cleanButton.addEventListener("click", async () => {
      const label = cleanButton.querySelector("span:last-child");
      const syncStatus = document.getElementById("sync-status");

      cleanButton.disabled = true;
      if (label) {
        label.textContent = "正在同步实时数据";
      }
      if (syncStatus) {
        syncStatus.textContent = "最近同步：正在抓取 Reddit 最新数据...";
        syncStatus.classList.remove("is-error");
        syncStatus.classList.add("is-syncing");
      }

      try {
        const result = await window.GameFeedbackMonitor.fetchApi("/api/admin/sync", {}, "POST");
        if (!result || !result.ok || !result.dataset || !result.dataset.overview) {
          throw new Error("同步结果无效");
        }

        updateSyncStatus(result.dataset.overview);
        window.setTimeout(() => {
          window.location.reload();
        }, 150);
      } catch (error) {
        if (syncStatus) {
          syncStatus.textContent = `同步失败：${error.message}`;
          syncStatus.classList.remove("is-syncing");
          syncStatus.classList.add("is-error");
        }
      } finally {
        cleanButton.disabled = false;
        if (label) {
          label.textContent = "刷新实时数据";
        }
      }
    });
  }

  function initPatch() {
    setText("title", "海外玩家反馈监控");
    updateStatLabels();
    replaceRefreshButton();
    refreshOverviewStatus();
    window.setTimeout(updateStatLabels, 800);
    window.setTimeout(refreshOverviewStatus, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPatch, { once: true });
  } else {
    initPatch();
  }
})();
