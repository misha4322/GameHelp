/** Dispatched after the author successfully saves a post (PATCH), when revision flags may be cleared. */
export const POST_REVISION_REFRESH_EVENT = "s3:post-revision-refresh";

export type PostRevisionRefreshDetail = { slug?: string };

/** Сравнение slug из API и из URL (кодирование может отличаться). */
export function revisionSlugMatches(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return decodeURIComponent(a) === decodeURIComponent(b);
  } catch {
    return false;
  }
}

export function emitPostRevisionRefresh(detail?: PostRevisionRefreshDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PostRevisionRefreshDetail>(POST_REVISION_REFRESH_EVENT, { detail })
  );
}
