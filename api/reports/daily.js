const { buildDataset } = require("../_lib/monitor");
const { methodNotAllowed, sendJson } = require("../_lib/response");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "GET") return methodNotAllowed(res);

  try {
    const dataset = await buildDataset({ persist: false, gameKey: req.query?.game });
    return sendJson(res, 200, dataset.report);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
};
