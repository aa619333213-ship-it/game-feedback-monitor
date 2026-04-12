const { syncLiveDataset } = require("../_lib/monitor");
const { methodNotAllowed, sendJson } = require("../_lib/response");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST" && req.method !== "GET") return methodNotAllowed(res);

  try {
    const mode =
      String(req.query?.mode || req.body?.mode || "light").toLowerCase() === "full" ? "full" : "light";
    const dataset = await syncLiveDataset(req.query?.game, mode);
    return sendJson(res, 200, {
      ok: true,
      result: {
        syncedAt: dataset.overview.lastSyncAt,
        ingested: dataset.posts.length,
        mode,
      },
      dataset,
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
};
