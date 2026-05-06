/** Единый лимит длины для текстов модерации, жалоб и комментариев к автору. */
export const MAX_MODERATION_TEXT_CHARS = 5000;

export function clampModerationText(raw: string, max = MAX_MODERATION_TEXT_CHARS): string {
  const s = raw.replace(/\r\n/g, "\n");
  if (s.length <= max) return s;
  return s.slice(0, max);
}
