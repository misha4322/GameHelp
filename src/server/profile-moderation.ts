import { applyModerationOrThrow, isModerationBlockedError, ModerationBlockedError } from "./moderation";

const PROFILE_TEXT_KEYS = [
  "statusText",
  "bio",
  "location",
  "websiteUrl",
  "telegram",
  "discord",
  "steamProfileUrl",
  "favoriteGames",
] as const;

export type ProfileTextFieldKey = (typeof PROFILE_TEXT_KEYS)[number];

/**
 * Применяет цензуру к строковым полям профиля в `patch` (мутирует значения на очищенный текст).
 */
export async function applyModerationToProfilePatch(
  userId: string,
  patch: Record<string, unknown>
): Promise<void> {
  for (const key of PROFILE_TEXT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const raw = patch[key];
    if (raw == null) continue;
    if (typeof raw !== "string") continue;
    if (!raw.trim()) continue;

    try {
      const m = await applyModerationOrThrow({
        userId,
        targetType: "profile",
        targetId: userId,
        scope: "profile",
        text: raw,
      });
      patch[key] = m.cleanText;
    } catch (e) {
      if (isModerationBlockedError(e)) {
        throw new ModerationBlockedError(e.matches, e.message, key);
      }
      throw e;
    }
  }
}
