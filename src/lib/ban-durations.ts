export const ALL_BAN_DURATION_KEYS = ["30m", "1h", "1d", "2d", "7d", "30d"] as const;
export type BanDurationKey = (typeof ALL_BAN_DURATION_KEYS)[number];

const MS_MINUTE = 60 * 1000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

export function banDurationToMs(key: BanDurationKey): number {
  const map: Record<BanDurationKey, number> = {
    "30m": 30 * MS_MINUTE,
    "1h": MS_HOUR,
    "1d": MS_DAY,
    "2d": 2 * MS_DAY,
    "7d": 7 * MS_DAY,
    "30d": 30 * MS_DAY,
  };
  return map[key];
}

export const BAN_DURATION_LABELS: Record<BanDurationKey, string> = {
  "30m": "30 минут",
  "1h": "1 час",
  "1d": "1 сутки",
  "2d": "2 суток",
  "7d": "7 дней",
  "30d": "30 дней",
};

export function isBanDurationKey(v: string): v is BanDurationKey {
  return (ALL_BAN_DURATION_KEYS as readonly string[]).includes(v);
}
