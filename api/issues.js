const { buildDataset } = require("./_lib/monitor");
const { methodNotAllowed, sendJson } = require("./_lib/response");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "GET") return methodNotAllowed(res);

  try {
    const dataset = await buildDataset({ persist: false });
    const system = req.query.system;
    const risk = req.query.risk;
    let items = [...dataset.issues];

    if (system && system !== "all") items = items.filter((item) => item.key === system);
    if (risk && risk !== "all") items = items.filter((item) => item.riskLevel === risk);

    return sendJson(res, 200, items);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
};
