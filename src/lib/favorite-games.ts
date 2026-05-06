/**
 * Технический потолок на количество записей (защита БД/памяти). В интерфейсе не рекламируется.
 * При превышении лишнее тихо отбрасывается при сохранении и разборе.
 */
const FAVORITE_GAMES_HARD_CAP = 400;

export type FavoriteGameEntry = {
  appid: number | null;
  name: string;
};

function legacyNameList(raw: string): FavoriteGameEntry[] {
  return raw
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name) => ({ appid: null, name: name.slice(0, 200) }));
}

function capEntries(list: FavoriteGameEntry[]): FavoriteGameEntry[] {
  if (list.length <= FAVORITE_GAMES_HARD_CAP) return list;
  return list.slice(0, FAVORITE_GAMES_HARD_CAP);
}

/** Разбор поля users.favorite_games: JSON-массив Steam или старый текст через запятую/переносы. */
export function parseFavoriteGamesField(raw: string | null | undefined): FavoriteGameEntry[] {
  if (!raw?.trim()) return [];
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const j = JSON.parse(t) as unknown;
      if (!Array.isArray(j)) return capEntries(legacyNameList(raw));
      const out: FavoriteGameEntry[] = [];
      for (const item of j) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const name = String(o.name ?? "").trim().slice(0, 200);
        if (!name) continue;
        let appid: number | null = null;
        if (typeof o.appid === "number" && Number.isFinite(o.appid) && o.appid > 0) {
          appid = Math.floor(o.appid);
        }
        out.push({ appid, name });
      }
      return capEntries(out);
    } catch {
      return capEntries(legacyNameList(raw));
    }
  }
  return capEntries(legacyNameList(t));
}

export function favoriteGamesToNameList(raw: string | null | undefined): string[] {
  return parseFavoriteGamesField(raw).map((e) => e.name);
}

export function serializeFavoriteGames(entries: FavoriteGameEntry[]): string {
  const slice = capEntries(entries).map((e) => ({
    appid: e.appid != null && e.appid > 0 ? e.appid : null,
    name: e.name.trim().slice(0, 200),
  }));
  return JSON.stringify(slice);
}

/** Проверка и нормализация JSON для PATCH (или null). Текст без `[` — как раньше, до 8000 символов. */
export function normalizeFavoriteGamesPatchValue(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null) return { ok: true, value: null };
  if (v === undefined) return { ok: false, error: "favoriteGames: нет значения" };
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return { ok: true, value: null };
  if (!s.startsWith("[")) {
    return { ok: true, value: s.slice(0, 8000) };
  }
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "Любимые игры: ожидался массив JSON" };
    }
    const out: FavoriteGameEntry[] = [];
    for (let i = 0; i < parsed.length && out.length < FAVORITE_GAMES_HARD_CAP; i++) {
      const item = parsed[i];
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const name = String(o.name ?? "").trim().slice(0, 200);
      if (!name) continue;
      let appid: number | null = null;
      if (typeof o.appid === "number" && Number.isFinite(o.appid) && o.appid > 0) {
        appid = Math.floor(o.appid);
      }
      out.push({ appid, name });
    }
    return { ok: true, value: JSON.stringify(out) };
  } catch {
    return { ok: false, error: "Любимые игры: невалидный JSON" };
  }
}

export function steamCapsuleUrl(appid: number) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_184x69.jpg`;
}
