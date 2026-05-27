import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SteamAppRow = { appid: number; name: string };

// Кэшируем список игр Steam (обновляем раз в день)
let gamesCache: SteamAppRow[] | null = null;
let cacheTime = 0;
/** Один запрос к Steam на все параллельные /api/steam/games (поиск печатает много раз подряд). */
let gamesLoadInFlight: Promise<SteamAppRow[]> | null = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 часа

async function loadSteamGamesFromNetwork(): Promise<SteamAppRow[]> {
  const now = Date.now();
  const STEAM_API_KEY = process.env.STEAM_SECRET;

  if (!STEAM_API_KEY) {
    console.error("STEAM_SECRET не найден в .env");
    return [];
  }

  try {
    console.log("Загрузка списка игр Steam...");
    
    // Убираем next: { revalidate } так как ответ слишком большой для кэша Next.js
    const res = await fetch(
      `https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${STEAM_API_KEY}&include_games=true&include_dlc=false&include_software=false&include_videos=false&include_hardware=false&max_results=50000`,
      { 
        cache: 'no-store', // отключаем кэш Next.js
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SteamApp/1.0'
        }
      }
    );
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Steam API error: ${res.status} ${res.statusText}`, errorText);
      
      // Если IStoreService не работает, пробуем старый API без ключа
      return await fetchSteamGamesLegacy();
    }
    
    const data = await res.json();
    
    // IStoreService возвращает другую структуру данных
    if (data.response && data.response.apps) {
      gamesCache = data.response.apps.map((app: any) => ({
        appid: app.appid,
        name: app.name || "Unknown"
      }));
    } else {
      console.error("Неожиданный формат ответа Steam API:", data);
      return await fetchSteamGamesLegacy();
    }
    
    cacheTime = now;
    const cached = gamesCache;
    console.log(`✅ Загружено ${cached?.length ?? 0} игр из Steam`);

    return cached ?? (await fetchSteamGamesLegacy());
  } catch (error) {
    console.error("Ошибка при загрузке игр Steam:", error);
    
    // Если есть старый кэш, возвращаем его
    if (gamesCache && gamesCache.length > 0) {
      console.log("Используем старый кэш игр");
      return gamesCache;
    }
    
    // Иначе пробуем старый API
    return await fetchSteamGamesLegacy();
  }
}

async function fetchSteamGames(): Promise<SteamAppRow[]> {
  const now = Date.now();

  if (gamesCache && now - cacheTime < CACHE_DURATION) {
    return gamesCache;
  }

  if (gamesLoadInFlight) {
    return gamesLoadInFlight;
  }

  gamesLoadInFlight = loadSteamGamesFromNetwork().finally(() => {
    gamesLoadInFlight = null;
  });

  return gamesLoadInFlight;
}

// Резервный метод: старый API без ключа (менее надежный)
async function fetchSteamGamesLegacy(): Promise<SteamAppRow[]> {
  try {
    console.log("Пробуем старый Steam API (ISteamApps/GetAppList/v2)...");
    
    const res = await fetch(
      "https://api.steampowered.com/ISteamApps/GetAppList/v2/",
      { 
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SteamApp/1.0'
        },
        signal: AbortSignal.timeout(10000) // timeout 10 секунд
      }
    );
    
    if (!res.ok) {
      console.error(`Старый Steam API тоже не работает: ${res.status}`);
      return [];
    }
    
    const data = await res.json();
    const apps = data.applist?.apps || [];

    console.log(`✅ Загружено ${apps.length} игр из старого Steam API`);

    return apps.map((a: { appid: number; name: string }) => ({
      appid: Number(a.appid),
      name: String(a.name ?? "Unknown"),
    }));
  } catch (error) {
    console.error("Старый Steam API недоступен:", error);
    return [];
  }
}

function mapGameRow(g: SteamAppRow) {
  return {
    appid: g.appid,
    name: g.name,
    headerImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
    capsuleImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_184x69.jpg`,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("search")?.toLowerCase().trim() || "";
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "40", 10) || 40));

    const allGames = await fetchSteamGames();

    // Проверка на null или пустой массив
    if (!allGames || allGames.length === 0) {
      return NextResponse.json({
        games: [],
        hasMore: false,
        total: 0,
        error: "Не удалось загрузить список игр из Steam. Проверьте STEAM_SECRET в .env",
      });
    }

    if (!query) {
      const slice = allGames.slice(offset, offset + limit);
      return NextResponse.json({
        games: slice.map(mapGameRow),
        total: allGames.length,
        hasMore: offset + limit < allGames.length,
        offset,
        limit,
      });
    }

    const filtered = allGames.filter(
      (g: SteamAppRow) => g.name && g.name.toLowerCase().includes(query)
    );
    const slice = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      games: slice.map(mapGameRow),
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
      offset,
      limit,
    });
  } catch (error) {
    console.error("Steam API route error:", error);
    return NextResponse.json({ 
      error: "Ошибка при обработке запроса", 
      games: [] 
    }, { status: 500 });
  }
}
