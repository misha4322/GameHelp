import { Elysia } from "elysia";
import type { SteamGameBase } from "../../types/steam";

let gamesCache: SteamGameBase[] | null = null;
let cacheTime = 0;

const CACHE_DURATION = 24 * 60 * 60 * 1000;

async function fetchSteamGamesLegacy() {
  try {
    const res = await fetch("https://api.steampowered.com/ISteamApps/GetAppList/v2/", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "SteamApp/1.0",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return (data.applist?.apps ?? []) as SteamGameBase[];
  } catch (error) {
    console.error("Legacy Steam API error:", error);
    return [];
  }
}

async function fetchSteamGames() {
  const now = Date.now();

  if (gamesCache && now - cacheTime < CACHE_DURATION) {
    return gamesCache;
  }

  const steamKey = process.env.STEAM_SECRET;

  if (!steamKey) {
    return await fetchSteamGamesLegacy();
  }

  try {
    const res = await fetch(
      `https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${steamKey}&include_games=true&include_dlc=false&include_software=false&include_videos=false&include_hardware=false&max_results=50000`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "SteamApp/1.0",
        },
      }
    );

    if (!res.ok) {
      return await fetchSteamGamesLegacy();
    }

    const data = await res.json();

    if (!data.response?.apps) {
      return await fetchSteamGamesLegacy();
    }

    gamesCache = data.response.apps.map((app: any) => ({
      appid: app.appid,
      name: app.name || "Unknown",
    }));

    cacheTime = now;

    return gamesCache;
  } catch (error) {
    console.error("Steam API error:", error);

    if (gamesCache && gamesCache.length > 0) {
      return gamesCache;
    }

    return await fetchSteamGamesLegacy();
  }
}

export const steamRouter = new Elysia({ prefix: "/steam" }).get(
  "/games",
  async ({ query }) => {
    const search = String(query.search ?? "").toLowerCase().trim();
    const allGames = await fetchSteamGames();

    if (!allGames || allGames.length === 0) {
      return {
        games: [],
        error: "Не удалось загрузить список игр из Steam",
      };
    }

    if (!search) {
      const topGames = allGames.slice(0, 100);

      return {
        games: topGames.map((game) => ({
          appid: game.appid,
          name: game.name,
          headerImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
          capsuleImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/capsule_184x69.jpg`,
        })),
        total: allGames.length,
      };
    }

    const filtered = allGames
      .filter((game) => game.name && game.name.toLowerCase().includes(search))
      .slice(0, 50)
      .map((game) => ({
        appid: game.appid,
        name: game.name,
        headerImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
        capsuleImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/capsule_184x69.jpg`,
      }));

    return {
      games: filtered,
      total: filtered.length,
    };
  }
);