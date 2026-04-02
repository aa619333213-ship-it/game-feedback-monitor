const { getRules, setRules } = require("./_lib/monitor");
const { methodNotAllowed, readJsonBody, sendJson } = require("./_lib/response");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  try {
    if (req.method === "GET") {
      return sendJson(res, 200, getRules());
    }

    if (req.method === "POST") {
      return sendJson(res, 200, setRules(await readJsonBody(req)));
    }

    return methodNotAllowed(res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
};
