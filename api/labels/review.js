const { saveReviewLabel } = require("../_lib/monitor");
const { methodNotAllowed, readJsonBody, sendJson } = require("../_lib/response");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    return sendJson(res, 200, saveReviewLabel(await readJsonBody(req)));
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
};
