const { methodNotAllowed, sendJson } = require("../_lib/response");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST") return methodNotAllowed(res);
  return sendJson(res, 200, { ok: true, message: "\u6a21\u62df\u544a\u8b66\u5df2\u53d1\u9001\u5230\u98de\u4e66 / \u4f01\u4e1a\u5fae\u4fe1\u3002" });
};
