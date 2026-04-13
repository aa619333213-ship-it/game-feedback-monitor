const { syncLiveDataset } = require("../_lib/monitor");
const { sendJson } = require("../_lib/response");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  try {
    const nowShanghai = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
    );
    const mode = nowShanghai.getHours() === 8 ? "full" : "light";
    const dataset = await syncLiveDataset(req.query?.game, mode);
    return sendJson(res, 200, {
      ok: true,
      mode,
      syncedAt: dataset.overview.lastSyncAt,
      ingested: dataset.posts.length,
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
};
