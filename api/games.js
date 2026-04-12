const fs = require("node:fs/promises");
const path = require("node:path");
const { methodNotAllowed, sendJson } = require("./_lib/response");

const GAMES_PATH = path.join(process.cwd(), "data", "games.json");

async function readGames() {
  const text = await fs.readFile(GAMES_PATH, "utf8");
  return JSON.parse(text);
}

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
