const { readGames } = require("./_lib/monitor");
const { methodNotAllowed, sendJson } = require("./_lib/response");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method !== "GET") return methodNotAllowed(res);

  try {
    const games = await readGames();
    return sendJson(res, 200, games);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
};
