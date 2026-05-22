import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

async function robloxGetJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "FateSpotlightPassScanner/1.0"
    }
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }

  return await res.json();
}

async function getUserUniverses(userId) {
  const universes = [];
  let cursor = "";

  for (let page = 0; page < 3; page++) {
    const url =
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&sortOrder=Asc&limit=50` +
      (cursor ? `&cursor=${cursor}` : "");

    const data = await robloxGetJson(url);

    for (const game of data.data || []) {
      if (game.id) {
        universes.push({
          universeId: game.id,
          name: game.name || "Experience"
        });
      }
    }

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }

  return universes;
}

async function getPassesForUniverse(universeId) {
  const passes = [];
  let cursor = "";

  for (let page = 0; page < 2; page++) {
    const url =
      `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?limit=50` +
      (cursor ? `&cursor=${cursor}` : "");

    const data = await robloxGetJson(url);

    for (const pass of data.gamePasses || data.data || []) {
      const id = pass.id || pass.gamePassId;
      const name = pass.name || "Game Pass";
      const price = pass.price || pass.priceInRobux || 0;

      if (id) {
        passes.push({
          id,
          name,
          price
        });
      }
    }

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }

  return passes;
}

app.get("/api/passes", async (req, res) => {
  try {
    const userId = Number(req.query.userId);
    const limit = Math.min(Number(req.query.limit) || 10, 10);

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const cacheKey = String(userId);
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.time < CACHE_MS) {
      return res.json({ passes: cached.passes.slice(0, limit) });
    }

    const universes = await getUserUniverses(userId);
    const allPasses = [];

    for (const universe of universes) {
      const passes = await getPassesForUniverse(universe.universeId);

      for (const pass of passes) {
        if (pass.price && pass.price > 0) {
          allPasses.push(pass);
        }
      }

      if (allPasses.length >= limit * 3) break;
    }

    allPasses.sort((a, b) => a.price - b.price);

    const finalPasses = allPasses.slice(0, limit);

    cache.set(cacheKey, {
      time: Date.now(),
      passes: finalPasses
    });

    res.json({ passes: finalPasses });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to scan passes",
      details: String(err.message || err)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Fate pass proxy running on port ${PORT}`);
});
