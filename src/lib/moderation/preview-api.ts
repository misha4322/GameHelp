import { parseApiJsonResponse } from "@/lib/parse-api-json";
import type { ModerationScope, ModerationTextMatch } from "./moderate-text";
import { readModerationBlockedPayload } from "./parse-blocked-response";

export type ModerationChangeDto = {
  ruleId: string;
  scope: ModerationScope;
  severity: "low" | "medium" | "high";
  original: string;
  replacement: string;
  maskedPhrase: string;
  start: number;
  end: number;
  kind: "remove" | "replace";
};

export type ModerationPreviewResult = {
  blocked: boolean;
  action: "none" | "censor" | "block";
  originalText: string;
  cleanText: string;
  changes: ModerationChangeDto[];
  matches: ModerationTextMatch[];
  matchedCount: number;
  censoredWords?: number;
  needsConfirm: boolean;
  punctuationPolished?: boolean;
  aiPolishStatus?: "ok" | "unchanged" | "failed" | "skipped";
  aiModerationStatus?: "ok" | "blocked" | "unchanged" | "failed" | "skipped";
  moderationSource?: "ai" | "regex";
  geminiQuotaExceeded?: boolean;
  sourceField?: string;
};

export async function requestModerationPreview(params: {
  text: string;
  scope: ModerationScope;
  userId?: string | null;
  sourceField?: string;
  skipAi?: boolean;
}): Promise<ModerationPreviewResult> {
  const res = await fetch("/api/moderation/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      scope: params.scope,
      userId: params.userId ?? undefined,
      sourceField: params.sourceField,
      skipAi: params.skipAi === true ? true : undefined,
    }),
  });

  const data = await parseApiJsonResponse(res);

  if (!res.ok) {
    const blocked = readModerationBlockedPayload(data);
    if (blocked) {
      return {
        blocked: true,
        action: "block",
        originalText: params.text,
        cleanText: params.text,
        changes: [],
        matches: blocked.matches,
        matchedCount: blocked.matches.length,
        needsConfirm: false,
        sourceField: blocked.sourceField,
      };
    }
    throw new Error(typeof data.error === "string" ? data.error : "Не удалось проверить текст");
  }

  const changes = Array.isArray(data.changes) ? (data.changes as ModerationChangeDto[]) : [];
  const matches = Array.isArray(data.matches) ? (data.matches as ModerationTextMatch[]) : [];

  return {
    blocked: Boolean(data.blocked),
    action:
      data.action === "censor" || data.action === "block" || data.action === "none"
        ? data.action
        : "none",
    originalText: typeof data.originalText === "string" ? data.originalText : params.text,
    cleanText: typeof data.cleanText === "string" ? data.cleanText : params.text,
    changes,
    matches,
    matchedCount: Number(data.matchedCount) || 0,
    censoredWords: Number(data.censoredWords) || changes.length || 0,
    needsConfirm: Boolean(data.needsConfirm),
    punctuationPolished: Boolean(data.punctuationPolished),
    aiPolishStatus:
      data.aiPolishStatus === "ok" ||
      data.aiPolishStatus === "unchanged" ||
      data.aiPolishStatus === "failed" ||
      data.aiPolishStatus === "skipped"
        ? data.aiPolishStatus
        : undefined,
    aiModerationStatus:
      data.aiModerationStatus === "ok" ||
      data.aiModerationStatus === "blocked" ||
      data.aiModerationStatus === "unchanged" ||
      data.aiModerationStatus === "failed" ||
      data.aiModerationStatus === "skipped"
        ? data.aiModerationStatus
        : undefined,
    moderationSource:
      data.moderationSource === "ai" || data.moderationSource === "regex"
        ? data.moderationSource
        : undefined,
    sourceField: typeof data.sourceField === "string" ? data.sourceField : undefined,
    geminiQuotaExceeded: Boolean(data.geminiQuotaExceeded),
  };
}
