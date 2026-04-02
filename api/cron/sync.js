const { buildDataset, forceRefresh } = require("../_lib/monitor");
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
    forceRefresh();
    const dataset = await buildDataset({ force: true });
    return sendJson(res, 200, {
      ok: true,
      syncedAt: dataset.overview.lastSyncAt,
      ingested: dataset.posts.length,
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
};
