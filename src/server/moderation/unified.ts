import type { ModerationResult, ModerationRule, ModerationScope } from "../../lib/moderation/moderate-text";
import { censorText, moderateText } from "../../lib/moderation/moderate-text";
import { aiModerationEnabled, moderateTextWithAi } from "./ai/content-moderation";

export type UnifiedModerationSource = "ai" | "regex";

export type UnifiedModerationOutcome = {
  result: ModerationResult;
  cleanText: string;
  source: UnifiedModerationSource;
  aiStatus: "ok" | "blocked" | "unchanged" | "failed" | "skipped";
};

function rulesForScope(rules: ModerationRule[], scope: ModerationScope): ModerationRule[] {
  return rules.filter((r) => r.isActive && (r.scope === "all" || r.scope === scope));
}

/** Цензура только через regex на исходном тексте — пунктуация и регистр сохраняются. */
function censorWithRuleIds(
  originalText: string,
  allRules: ModerationRule[],
  scope: ModerationScope,
  ruleIds: string[]
): { blocked: boolean; cleanText: string; applied: ModerationRule[] } {
  const idSet = new Set(ruleIds);
  const applied = rulesForScope(allRules, scope).filter((r) => idSet.has(r.id));

  if (applied.some((r) => r.action === "block")) {
    return { blocked: true, cleanText: originalText, applied };
  }

  const censorRules = applied.filter((r) => r.action === "censor");
  const cleanText =
    censorRules.length > 0 ? censorText(originalText, censorRules) : originalText;

  return { blocked: false, cleanText, applied };
}

function buildResultFromCensor(
  originalText: string,
  regexMeta: ModerationResult,
  cleanText: string,
  applied: ModerationRule[]
): ModerationResult {
  const changed = cleanText !== originalText;
  const blocked = applied.some((r) => r.action === "block");
  const censored = !blocked && changed;

  return {
    ...regexMeta,
    originalText,
    cleanText,
    blocked,
    censored,
    action: blocked ? "block" : censored ? "censor" : "none",
    matchedCount: applied.length > 0 ? Math.max(applied.length, regexMeta.matchedCount) : regexMeta.matchedCount,
    matchedRules: applied.length > 0 ? applied : regexMeta.matchedRules,
    matches: regexMeta.matches,
  };
}

/**
 * Модерация: regex на сервере; Gemini возвращает id правил из БД (текст не переписывает модель).
 */
export async function moderateContentUnified(
  text: string,
  rules: ModerationRule[],
  scope: ModerationScope,
  options?: { skipAi?: boolean }
): Promise<UnifiedModerationOutcome> {
  const originalText = String(text ?? "");
  const regexResult = moderateText(originalText, rules, scope);

  if (options?.skipAi || !aiModerationEnabled()) {
    return {
      result: regexResult,
      cleanText: regexResult.cleanText,
      source: "regex",
      aiStatus: "skipped",
    };
  }

  const matchedRuleIds = regexResult.matches.map((m) => m.ruleId);
  const ai = await moderateTextWithAi({
    text: originalText,
    scope,
    rules,
    matchedRuleIds,
    skipAi: options?.skipAi,
  });

  if (ai.status === "failed" || ai.status === "skipped") {
    return {
      result: regexResult,
      cleanText: regexResult.cleanText,
      source: "regex",
      aiStatus: ai.status,
    };
  }

  if (ai.blocked) {
    return {
      result: {
        ...regexResult,
        blocked: true,
        censored: false,
        action: "block",
        cleanText: originalText,
      },
      cleanText: originalText,
      source: "ai",
      aiStatus: "blocked",
    };
  }

  const unionIds = new Set([
    ...regexResult.matchedRules.map((r) => r.id),
    ...ai.ruleIds,
  ]);

  const { blocked, cleanText, applied } = censorWithRuleIds(
    originalText,
    rules,
    scope,
    [...unionIds]
  );

  if (blocked) {
    return {
      result: {
        ...regexResult,
        blocked: true,
        censored: false,
        action: "block",
        cleanText: originalText,
      },
      cleanText: originalText,
      source: "ai",
      aiStatus: "blocked",
    };
  }

  const changed = cleanText !== originalText;
  const source: UnifiedModerationSource =
    ai.ruleIds.length > 0 && ai.status === "ok" ? "ai" : "regex";

  return {
    result: buildResultFromCensor(originalText, regexResult, cleanText, applied),
    cleanText,
    source,
    aiStatus: changed || ai.ruleIds.length > 0 ? ai.status : "unchanged",
  };
}
