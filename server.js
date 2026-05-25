import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

async function getJson(url) {
  const headers = {
    "User-Agent": "FateSpotlightPassScanner/1.0"
  };

  if (process.env.ROBLOX_API_KEY) {
    headers["x-api-key"] = process.env.ROBLOX_API_KEY;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} - ${url}`);
  }

  return await response.json();
}
async function getUserGames(userId) {
  const games = [];
  let cursor = "";

  for (let page = 0; page < 5; page++) {
    const url =
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&sortOrder=Asc&limit=50` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

    const data = await getJson(url);

    for (const game of data.data || []) {
      if (game.id) {
        games.push({
          universeId: game.id,
          name: game.name || "Experience"
        });
      }
    }

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }

  return games;
}

async function getGamePasses(universeId) {
  const passes = [];
  let cursor = "";

  for (let page = 0; page < 5; page++) {
    const url =
      `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes/creator?limit=50` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

    const data = await getJson(url);

    const list = data.gamePasses || data.data || [];

    for (const pass of list) {
      const id = pass.gamePassId || pass.id;
      const name = pass.name || "Game Pass";

      const price =
        pass.priceInformation?.defaultPriceInRobux ??
        pass.priceInRobux ??
        pass.price ??
        0;

      const iconImageAssetId =
        pass.iconAssetId ??
        pass.iconImageAssetId ??
        pass.iconImageId ??
        0;

      if (id) {
        passes.push({
          id,
          name,
          price,
          iconImageAssetId,
          universeId
        });
      }
    }

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }

  return passes;
}

app.get("/", (req, res) => {
  res.json({
    status: "Fate Spotlight pass proxy is running",
    test: "/api/passes?userId=1"
  });
});

app.get("/api/passes", async (req, res) => {
  try {
    const userId = Number(req.query.userId);
    const limit = Math.min(Number(req.query.limit) || 10, 10);

    if (!userId) {
      return res.status(400).json({
        error: "Missing or invalid userId"
      });
    }

    const cacheKey = `${userId}:${limit}`;
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.time < CACHE_MS) {
      return res.json(cached.data);
    }

    const games = await getUserGames(userId);
    const allPasses = [];

    for (const game of games) {
      const passes = await getGamePasses(game.universeId);

      for (const pass of passes) {
        const price = Number(pass.price) || 0;

        if (price > 0) {
          allPasses.push({
            id: Number(pass.id),
            name: pass.name,
            price,
            iconImageAssetId: Number(pass.iconImageAssetId) || 0,
            universeId: game.universeId,
            universeName: game.name
          });
        }
      }
    }

    const seen = new Set();

    const finalPasses = allPasses
      .filter((pass) => {
        if (!pass.id || seen.has(pass.id)) return false;
        seen.add(pass.id);
        return true;
      })
      .sort((a, b) => a.price - b.price)
      .slice(0, limit);

    const result = {
      userId,
      gameCount: games.length,
      passCount: finalPasses.length,
      passes: finalPasses
    };

    cache.set(cacheKey, {
      time: Date.now(),
      data: result
    });

    res.json(result);
  } catch (error) {
    console.error("[PASS SCANNER ERROR]", error);

    res.status(500).json({
      error: "Failed to scan passes",
      details: String(error.message || error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Fate Spotlight pass proxy running on port ${PORT}`);
});
