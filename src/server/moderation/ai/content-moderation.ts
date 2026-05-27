import type { ModerationRule, ModerationScope } from "../../../lib/moderation/moderate-text";
import { textForModerationMatching } from "../../../lib/moderation/moderate-text";
import { maskModerationPhrase, normalizeForModeration } from "../../../lib/moderation/normalize";
import {
  geminiApiAvailable,
  geminiGenerateText,
  geminiQuotaBlocked,
  geminiSupportsJsonMode,
  resolveAiProvider,
} from "./gemini-client";

export type AiModerationResult = {
  blocked: boolean;
  /** id правил из RULES, которые сработали (режим apply) */
  ruleIds: string[];
  status: "ok" | "blocked" | "unchanged" | "failed" | "skipped";
};

const DEFAULT_APPLY_SYSTEM = `Модератор GameHelp. По RULES найди сработавшие правила на ТЕКСТЕ пользователя.

НЕ переписывай текст. НЕ исправляй орфографию и пунктуацию. Не придумывай новых запрещённых слов.

Ответ — ТОЛЬКО JSON (без markdown, без пояснений):
{"blocked":true}
или
{"blocked":false,"ruleIds":["id1","id2"]}

id — точные id из RULES. Если ничего не сработало: {"blocked":false,"ruleIds":[]}

Совпадения как на сайте: без регистра; латиница≈кириллица; между буквами .-*-/; гласные в RULES могут отсутствовать в тексте.`;

const DEFAULT_REWRITE_SYSTEM = `Модератор GameHelp. Примени RULES. При block — только BLOCKED. Иначе только очищенный текст. Без *** если replacement удалить.`;

function aiModerationMode(): "apply" | "rewrite" {
  const m = String(process.env.OPENAI_MODERATION_MODE ?? "apply").trim().toLowerCase();
  return m === "rewrite" ? "rewrite" : "apply";
}

function chatCompletionsUrl(): string {
  const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function requestTimeoutMs(): number {
  const base = process.env.OPENAI_BASE_URL ?? "";
  if (/127\.0\.0\.1|localhost/i.test(base)) return 90_000;
  const parsed = Number(process.env.OPENAI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25_000;
}

function maxOutputTokens(inputLen: number, mode: "apply" | "rewrite"): number {
  if (mode === "apply") {
    const cap = Number(process.env.OPENAI_MODERATION_JSON_MAX_TOKENS);
    return Number.isFinite(cap) && cap > 0 ? cap : 1024;
  }
  const cap = Number(process.env.OPENAI_MAX_TOKENS);
  if (Number.isFinite(cap) && cap > 0) return cap;
  return Math.min(1024, Math.max(256, Math.ceil(inputLen * 1.15)));
}

function maxRulesInPrompt(): number {
  const n = Number(process.env.OPENAI_MODERATION_MAX_RULES);
  if (n === 0) return 500;
  if (Number.isFinite(n) && n > 0) return Math.min(500, Math.floor(n));
  return resolveAiProvider() === "gemini" ? 200 : 40;
}

function contextTokenBudget(): number {
  const n = Number(process.env.OPENAI_MODERATION_CONTEXT_TOKENS);
  if (n === 0) return 120_000;
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return resolveAiProvider() === "gemini" ? 120_000 : 3200;
}

function trimRulesDisabled(): boolean {
  const raw = String(process.env.GEMINI_NO_TRIM ?? "1").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function estimateTokens(text: string): number {
  return Math.ceil(String(text).length / 3.2);
}

function consonantSkeleton(norm: string): string {
  return norm.replace(/[аеёиоуыэюя]/g, "");
}

function replacementLabel(rule: ModerationRule): string {
  if (rule.replacement === "..." || rule.replacement === "***") return "удалить";
  if (rule.replacement != null && String(rule.replacement).trim() === "") return "удалить";
  return String(rule.replacement ?? "удалить");
}

function ruleMightApply(rule: ModerationRule, normText: string, skText: string): boolean {
  const np = (rule.normalizedPhrase || normalizeForModeration(rule.phrase)).trim();
  if (np.length < 2) return false;
  if (normText.includes(np)) return true;
  const sk = consonantSkeleton(np);
  if (sk.length >= 3 && skText.includes(sk)) return true;
  return false;
}

export function selectRulesForAiPrompt(
  text: string,
  rules: ModerationRule[],
  scope: ModerationScope,
  matchedRuleIds: string[] = []
): ModerationRule[] {
  const maxRules = maxRulesInPrompt();
  const matchText = textForModerationMatching(text);
  const normText = normalizeForModeration(matchText);
  const skText = consonantSkeleton(normText);
  const matchedSet = new Set(matchedRuleIds);

  const active = rules.filter((r) => r.isActive && (r.scope === "all" || r.scope === scope));
  const byId = new Map(active.map((r) => [r.id, r]));
  const ordered: ModerationRule[] = [];
  const seen = new Set<string>();

  const push = (r: ModerationRule | undefined) => {
    if (!r || seen.has(r.id) || ordered.length >= maxRules) return;
    seen.add(r.id);
    ordered.push(r);
  };

  for (const id of matchedRuleIds) push(byId.get(id));

  const candidates: ModerationRule[] = [];
  for (const r of active) {
    if (seen.has(r.id)) continue;
    if (matchedSet.has(r.id) || ruleMightApply(r, normText, skText)) {
      candidates.push(r);
    }
  }
  candidates.sort(
    (a, b) =>
      (a.normalizedPhrase || normalizeForModeration(a.phrase)).length -
      (b.normalizedPhrase || normalizeForModeration(b.phrase)).length
  );
  for (const r of candidates) push(r);

  // Иначе Gemini не вызывается (0 rules) — в Google AI Studio «0 запросов»
  if (ordered.length === 0) {
    for (const r of active) push(r);
  }

  return ordered;
}

export function formatRulesBlock(rules: ModerationRule[], scope: ModerationScope): string {
  const lines = rules.map((r) => {
    const tag = r.action === "block" ? "B" : "C";
    return `${tag}|${r.id}|${r.phrase}|${replacementLabel(r)}`;
  });
  return `SCOPE:${scope}\nRULES(${rules.length}):\n${lines.join("\n")}`;
}

function trimRulesToFitBudget(
  system: string,
  text: string,
  rules: ModerationRule[],
  scope: ModerationScope
): { rules: ModerationRule[]; userPayload: string } {
  if (trimRulesDisabled()) {
    const userPayload = `${formatRulesBlock(rules, scope)}\n---\nТЕКСТ:\n${text}`;
    return { rules, userPayload };
  }

  const budget = contextTokenBudget();
  const mode = aiModerationMode();
  const outReserve = maxOutputTokens(text.length, mode);
  let slice = [...rules];

  while (slice.length > 0) {
    const userPayload = `${formatRulesBlock(slice, scope)}\n---\nТЕКСТ:\n${text}`;
    const total = estimateTokens(system) + estimateTokens(userPayload) + outReserve;
    if (total <= budget) {
      return { rules: slice, userPayload };
    }
    slice = slice.slice(0, Math.max(1, Math.floor(slice.length * 0.75)));
  }

  const userPayload = `${formatRulesBlock([], scope)}\n---\nТЕКСТ:\n${text}`;
  return { rules: [], userPayload };
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function stripModelReasoning(raw: string): string {
  let s = String(raw ?? "");
  s = s.replace(/[\s\S]*?<\/think>/gi, "");
  s = s.replace(/[\s\S]*?<\/redacted_thinking>/gi, "");
  return s.trim();
}

function extractKnownRuleIds(text: string, allowedIds: Set<string>): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(UUID_RE)) {
    const id = m[0]!.toLowerCase();
    if (allowedIds.has(id)) found.add(id);
  }
  return [...found];
}

function idsFromPayload(o: Record<string, unknown>): string[] {
  const raw =
    o.ruleIds ??
    o.rule_ids ??
    o.apply ??
    o.rules ??
    o.ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id).trim()).filter(Boolean);
}

export function parseAiModerationResponse(
  raw: string,
  allowedIds: Set<string>
): { blocked: boolean; ruleIds: string[] } | null {
  let s = stripModelReasoning(raw);
  if (!s) return null;
  if (/^BLOCKED\s*$/i.test(s)) return { blocked: true, ruleIds: [] };

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();

  const tryParseObject = (jsonStr: string) => {
    const o = JSON.parse(jsonStr) as Record<string, unknown>;
    if (o.blocked === true) return { blocked: true, ruleIds: [] as string[] };
    const ruleIds = idsFromPayload(o).filter((id) => allowedIds.has(id));
    return { blocked: false, ruleIds };
  };

  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return tryParseObject(jsonMatch[0]!);
    } catch {
      const repaired = jsonMatch[0]!.replace(/,\s*([}\]])/g, "$1");
      try {
        return tryParseObject(repaired);
      } catch {
        /* fall through */
      }
    }
  }

  const fromUuids = extractKnownRuleIds(s, allowedIds);
  if (fromUuids.length > 0) {
    return { blocked: false, ruleIds: fromUuids };
  }

  return null;
}

export function activeRuleIdSet(rules: ModerationRule[], scope: ModerationScope): Set<string> {
  return new Set(
    rules
      .filter((r) => r.isActive && (r.scope === "all" || r.scope === scope))
      .map((r) => r.id)
  );
}

function isBadRewriteOutput(original: string, rewritten: string): boolean {
  if (!rewritten || rewritten === original) return false;
  if (/\*{2,}/.test(rewritten) && !/\*{2,}/.test(original)) return true;
  if (rewritten.length < original.length * 0.55) return true;
  const punctOrig = (original.match(/[.!?…—]/g) ?? []).length;
  const punctNew = (rewritten.match(/[.!?…—]/g) ?? []).length;
  if (punctOrig >= 2 && punctNew < punctOrig * 0.4) return true;
  return false;
}

export function aiModerationEnabled(): boolean {
  const raw = String(process.env.OPENAI_MODERATION_ENABLED ?? "1").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (resolveAiProvider() === "gemini") return geminiApiAvailable();
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getModerationSystemPrompt(): string {
  const custom = process.env.OPENAI_MODERATION_SYSTEM_PROMPT?.trim();
  if (custom) return custom;
  return aiModerationMode() === "apply" ? DEFAULT_APPLY_SYSTEM : DEFAULT_REWRITE_SYSTEM;
}

export async function moderateTextWithAi(params: {
  text: string;
  scope: ModerationScope;
  rules: ModerationRule[];
  matchedRuleIds?: string[];
  skipAi?: boolean;
}): Promise<AiModerationResult> {
  const trimmed = String(params.text ?? "").trim();
  if (params.skipAi) {
    return { blocked: false, ruleIds: [], status: "skipped" };
  }
  if (!aiModerationEnabled()) {
    console.warn(
      "[ai-moderation] skip: provider=",
      resolveAiProvider(),
      "key=",
      Boolean(process.env.GOOGLE_GEMINI_API_KEY),
      "quota=",
      geminiQuotaBlocked()
    );
    return { blocked: false, ruleIds: [], status: "skipped" };
  }
  if (trimmed.length < 1) {
    return { blocked: false, ruleIds: [], status: "skipped" };
  }

  const maxChars = Number(process.env.OPENAI_MODERATION_MAX_CHARS) || 12_000;
  if (trimmed.length > maxChars) {
    console.warn(`[ai-moderation] text too long (${trimmed.length}), skipped`);
    return { blocked: false, ruleIds: [], status: "skipped" };
  }

  const selected = selectRulesForAiPrompt(
    trimmed,
    params.rules,
    params.scope,
    params.matchedRuleIds ?? []
  );

  if (selected.length === 0) {
    console.warn("[ai-moderation] skip: нет активных правил в moderation_words для scope", params.scope);
    return { blocked: false, ruleIds: [], status: "skipped" };
  }

  const mode = aiModerationMode();
  const system = getModerationSystemPrompt();
  const { rules: fittedRules, userPayload } = trimRulesToFitBudget(
    system,
    trimmed,
    selected,
    params.scope
  );

  if (fittedRules.length === 0) {
    console.warn("[ai-moderation] prompt too large even with 0 rules, skipped");
    return { blocked: false, ruleIds: [], status: "skipped" };
  }

  const allowedIds = activeRuleIdSet(params.rules, params.scope);
  const provider = resolveAiProvider();
  const outTokens = maxOutputTokens(trimmed.length, mode);

  let out = "";

  try {
    if (provider === "gemini") {
      const cfgModel = process.env.GEMINI_MODEL ?? "gemma-4-31b-it";
      console.info(
        `[ai-moderation] gemini request model=${cfgModel} rules=${fittedRules.length} chars=${trimmed.length}`
      );
      const { text, error, quotaExceeded, statusCode } = await geminiGenerateText({
        systemInstruction: system,
        userText: userPayload,
        jsonMode: mode === "apply" && geminiSupportsJsonMode(cfgModel),
        maxOutputTokens: outTokens,
        temperature: 0,
      });
      if (!text) {
        if (quotaExceeded || statusCode === 429) {
          console.warn(`[ai-moderation] gemini quota (${cfgModel})`);
        } else {
          console.warn(
            `[ai-moderation] gemini failed model=${cfgModel} (${fittedRules.length} rules):`,
            error?.slice(0, 280)
          );
        }
        return { blocked: false, ruleIds: [], status: "failed" };
      }
      out = text;
    } else {
      const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
      const key = process.env.OPENAI_API_KEY!.trim();
      const requestBody: Record<string, unknown> = {
        model,
        temperature: 0,
        max_tokens: outTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPayload },
        ],
      };
      if (mode === "apply") {
        requestBody.response_format = { type: "json_object" };
      }

      const res = await fetch(chatCompletionsUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.warn(`[ai-moderation] openai HTTP ${res.status}`, errBody.slice(0, 280));
        return { blocked: false, ruleIds: [], status: "failed" };
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      out = data.choices?.[0]?.message?.content?.trim() ?? "";
    }

    if (mode === "apply") {
      const parsed = parseAiModerationResponse(out, allowedIds);
      if (!parsed) {
        console.warn(
          `[ai-moderation] invalid JSON (${fittedRules.length} rules, ${provider}), fallback to regex:`,
          out.slice(0, 200) || "(пустой ответ)"
        );
        return { blocked: false, ruleIds: [], status: "failed" };
      }
      if (parsed.blocked) {
        return { blocked: true, ruleIds: [], status: "blocked" };
      }
      const status =
        parsed.ruleIds.length > 0 ? "ok"
        : "unchanged";
      return { blocked: false, ruleIds: parsed.ruleIds, status };
    }

    // legacy rewrite (не рекомендуется для LM Studio)
    if (/^BLOCKED\s*$/i.test(out)) {
      return { blocked: true, ruleIds: [], status: "blocked" };
    }
    let text = out;
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("«") && text.endsWith("»"))
    ) {
      text = text.slice(1, -1).trim();
    }
    if (!text || isBadRewriteOutput(trimmed, text)) {
      return { blocked: false, ruleIds: [], status: "failed" };
    }
    if (text === trimmed) {
      return { blocked: false, ruleIds: [], status: "unchanged" };
    }
    console.warn("[ai-moderation] rewrite mode returned text; use OPENAI_MODERATION_MODE=apply");
    return { blocked: false, ruleIds: [], status: "failed" };
  } catch (e) {
    console.warn("[ai-moderation] failed:", e instanceof Error ? e.message : e);
    return { blocked: false, ruleIds: [], status: "failed" };
  }
}

export function rulesPromptStats(
  rules: ModerationRule[],
  scope: ModerationScope,
  text?: string,
  matchedRuleIds: string[] = []
) {
  const active = rules.filter((r) => r.isActive && (r.scope === "all" || r.scope === scope));
  const selected =
    text != null ?
      selectRulesForAiPrompt(text, rules, scope, matchedRuleIds)
    : active.slice(0, maxRulesInPrompt());
  return {
    total: active.length,
    selected: selected.length,
    maskedSample: selected.slice(0, 3).map((r) => maskModerationPhrase(r.phrase)),
  };
}
