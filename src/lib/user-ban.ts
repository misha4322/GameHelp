
export type UserBanRow = {
  isBanned: boolean;
  bannedUntil: Date | null;
};

export type PostingBanResult =
  | { ok: true }
  | { ok: false; error: string };

export function checkUserPostingBan(me: UserBanRow | null | undefined): PostingBanResult {
  const now = new Date();
  if (me?.isBanned && !me.bannedUntil) {
    return { ok: false, error: "Аккаунт заблокирован. Писать комментарии и создавать посты нельзя." };
  }
  if (me?.bannedUntil && me.bannedUntil > now) {
    return {
      ok: false,
      error:
        "Вы в бане и не можете писать комментарии и создавать посты до " +
        me.bannedUntil.toLocaleString("ru-RU") +
        ".",
    };
  }
  return { ok: true };
}
