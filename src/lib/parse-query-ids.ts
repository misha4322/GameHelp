const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Строка похожа на UUID — тогда безопасно подставлять в колонку uuid (иначе Postgres падает с 22P02). */
export function isUuidString(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Разбор списка UUID из query (через запятую), с ограничением длины. */
export function parseUuidList(raw: string | null | undefined, max: number): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!UUID_RE.test(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
