import { maskModerationPhrase } from "./normalize";

export type ModerationScope = "all" | "posts" | "comments" | "messages" | "profile";
export type ModerationAction = "censor" | "block";
export type ModerationSeverity = "low" | "medium" | "high";

export type ModerationRule = {
  id: string;
  phrase: string;
  normalizedPhrase: string;
  action: ModerationAction;
  scope: ModerationScope;
  severity: ModerationSeverity;
  replacement: string;
  isActive: boolean;
};

/** Совпадение в исходном тексте пользователя (индексы в `originalText`). */
export type ModerationTextMatch = {
  ruleId: string;
  phrase: string;
  maskedPhrase: string;
  action: ModerationAction;
  severity: ModerationSeverity;
  start: number;
  end: number;
  /** Фрагмент из текста пользователя */
  text: string;
};

export type ModerationResult = {
  originalText: string;
  cleanText: string;
  blocked: boolean;
  censored: boolean;
  matchedCount: number;
  action: "none" | "censor" | "block";
  matchedRules: ModerationRule[];
  matches: ModerationTextMatch[];
};

/** Фразы короче не используются: иначе ложные block на частицах «и», «а», «у», двух латинских буквах в словах и т.п. */
export const MIN_MODERATION_PHRASE_CHARS = 3;

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Текст только для поиска совпадений с правилами: URL, data URI, HTML-теги,
 * markdown-картинки/ссылки — маскируются, чтобы подстроки в путях/атрибутах не давали ложный block.
 */
export function textForModerationMatching(input: string): string {
  let s = String(input ?? "");
  s = s.replace(/[\u200b-\u200d\uFEFF]/g, "");
  s = s.replace(/data:image\/[^\s)]+/gi, (m) => " ".repeat(m.length));
  s = s.replace(/(?:https?|ftp|blob):\/\/[^\s)\]]+/gi, (m) => " ".repeat(m.length));
  s = s.replace(/wss?:\/\/[^\s)\]]+/gi, (m) => " ".repeat(m.length));
  s = s.replace(/\]\(\/\/[^\s)]+\)/gi, (m) => " ".repeat(m.length));
  s = s.replace(/(^|\s)\/\/[^\s)\]]+/gi, (m) => " ".repeat(m.length));
  s = s.replace(/www\.[^\s)\]]+/gi, (m) => " ".repeat(m.length));
  s = s.replace(/<[^>]{0,2000}?>/g, (m) => " ".repeat(Math.max(1, m.length)));
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/gi, (m) => " ".repeat(m.length));
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/gi, (m) => " ".repeat(m.length));
  return s;
}

function charPattern(ch: string): string {
  const c = ch.toLowerCase();
  switch (c) {
    case "а":
      return "[аa]";
    case "е":
      return "[еe]";
    case "о":
      return "[оo]";
    case "р":
      return "[рp]";
    case "с":
      return "[сc]";
    case "х":
      return "[хx]";
    case "у":
      return "[уy]";
    case "к":
      return "[кk]";
    case "м":
      return "[мm]";
    case "т":
      return "[тt]";
    case "н":
      return "[нh]";
    case "в":
      return "[вb]";
    default:
      return escapeRegex(ch);
  }
}

export function buildLoosePhraseRegex(normalizedPhrase: string): RegExp | null {
  const norm = String(normalizedPhrase ?? "").trim();
  if (norm.length < MIN_MODERATION_PHRASE_CHARS) return null;

  const between = "[\\s\\.,\\-_\\*\\/\\\\]*";
  const parts: string[] = [];
  for (const raw of norm) {
    parts.push(`${charPattern(raw)}+`);
  }
  const inner = parts.join(between);

  const leftBoundary = "(^|[^\\p{L}\\p{N}])";
  const rightBoundary = "(?=[^\\p{L}\\p{N}]|$)";
  const pattern = `${leftBoundary}(${inner})${rightBoundary}`;
  return new RegExp(pattern, "giu");
}

export function hasBlockedMatch(
  input: string,
  rules: ModerationRule[],
  scope: ModerationScope
): boolean {
  const res = moderateText(input, rules, scope);
  return res.blocked;
}

export function censorText(input: string, matchedRules: ModerationRule[]): string {
  let out = input;
  for (const rule of matchedRules) {
    if (rule.action !== "censor") continue;
    const rx = buildLoosePhraseRegex(rule.normalizedPhrase);
    if (!rx) continue;
    const replacement = rule.replacement?.trim() || "...";
    out = out.replace(rx, (full, boundary: string) => `${boundary}${replacement}`);
  }
  return out;
}

function collectMatchesForRule(
  originalText: string,
  matchText: string,
  rule: ModerationRule
): ModerationTextMatch[] {
  const rx = buildLoosePhraseRegex(rule.normalizedPhrase);
  if (!rx) return [];

  const out: ModerationTextMatch[] = [];
  rx.lastIndex = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = rx.exec(matchText)) !== null) {
    n++;
    if (n > 50) break;

    const boundary = m[1] ?? "";
    const inner = m[2] ?? "";
    const start = m.index + boundary.length;
    const end = start + inner.length;
    if (end > start) {
      out.push({
        ruleId: rule.id,
        phrase: rule.phrase,
        maskedPhrase: maskModerationPhrase(rule.phrase),
        action: rule.action,
        severity: rule.severity,
        start,
        end,
        text: originalText.slice(start, end),
      });
    }

    if (m[0].length === 0) {
      rx.lastIndex++;
    }
  }
  return out;
}

export function moderateText(
  input: string,
  rules: ModerationRule[],
  scope: ModerationScope
): ModerationResult {
  const originalText = String(input ?? "");
  const matchText = textForModerationMatching(originalText);

  const activeRules = rules.filter(
    (r) =>
      r.isActive &&
      (r.scope === "all" || r.scope === scope) &&
      r.normalizedPhrase.trim().length >= MIN_MODERATION_PHRASE_CHARS
  );

  const matchedRules: ModerationRule[] = [];
  const matches: ModerationTextMatch[] = [];
  let matchedCount = 0;
  let hasCensor = false;
  let hasBlock = false;

  for (const rule of activeRules) {
    const ruleMatches = collectMatchesForRule(originalText, matchText, rule);
    if (ruleMatches.length === 0) continue;

    matchedRules.push(rule);
    matchedCount += ruleMatches.length;
    matches.push(...ruleMatches);
    if (rule.action === "block") hasBlock = true;
    if (rule.action === "censor") hasCensor = true;
  }

  const blocked = hasBlock;
  const censored = !blocked && hasCensor;
  const cleanText = blocked
    ? originalText
    : censored
      ? censorText(originalText, matchedRules)
      : originalText;

  const action: ModerationResult["action"] = blocked ? "block" : censored ? "censor" : "none";

  return {
    originalText,
    cleanText,
    blocked,
    censored,
    matchedCount,
    action,
    matchedRules,
    matches,
  };
}
