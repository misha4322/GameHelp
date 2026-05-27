import type { ModerationScope } from "../../lib/moderation/moderate-text";
import { geminiQuotaBlocked } from "./ai/gemini-client";
import { polishTextEnabled, polishTextPunctuation } from "./ai/text-polish";
import { moderationBlockedHttpBody, previewModeration } from "./core";

function shouldSkipGeminiForField(sourceField: string | undefined): boolean {
  return sourceField === "title";
}

export async function handleModerationPreview(body: {
  text?: string;
  scope: ModerationScope;
  sourceField?: string;
  skipAi?: boolean;
}) {
  const text = String(body.text ?? "").trim();
  const scope = body.scope;
  const sourceField =
    typeof body.sourceField === "string" && body.sourceField.trim()
      ? body.sourceField.trim()
      : undefined;

  if (!text) {
    return { status: 400 as const, body: { error: "Пустой текст" } };
  }

  const skipAi = body.skipAi === true || shouldSkipGeminiForField(sourceField);

  try {
    const { result, cleanText, changes, aiStatus, moderationSource } = await previewModeration({
      scope,
      text,
      skipAi,
    });

    const geminiQuotaExceeded =
      aiStatus === "failed" && geminiQuotaBlocked();

    if (result.blocked) {
      const blockMatches = result.matches.filter((m) => m.action === "block");
      return {
        status: 200 as const,
        body: {
          blocked: true,
          action: result.action,
          originalText: text,
          cleanText: text,
          changes: [],
          matches: blockMatches,
          matchedCount: result.matchedCount,
          punctuationPolished: false,
          aiPolishStatus: "skipped",
          aiModerationStatus: aiStatus,
          moderationSource,
          geminiQuotaExceeded,
          ...(sourceField ? { sourceField } : {}),
        },
      };
    }

    let finalClean = cleanText;
    let aiPolishStatus: "ok" | "unchanged" | "failed" | "skipped" = "skipped";
    let punctuationPolished = false;

    const polishTitle =
      String(process.env.GEMINI_POLISH_TITLE ?? "0").trim().toLowerCase() === "1";
    const mayPolish =
      polishTextEnabled() &&
      finalClean.length >= 2 &&
      !geminiQuotaBlocked() &&
      aiStatus !== "failed" &&
      (sourceField !== "title" || polishTitle);

    if (mayPolish) {
      const polished = await polishTextPunctuation(finalClean);
      aiPolishStatus = polished.status;
      if (polished.text && (polished.status === "ok" || polished.status === "unchanged")) {
        finalClean = polished.text;
        punctuationPolished = polished.status === "ok" && polished.text !== cleanText;
      }
    }

    const needsConfirm = finalClean !== text;

    return {
      status: 200 as const,
      body: {
        blocked: false,
        action: result.action,
        originalText: text,
        cleanText: finalClean,
        changes,
        matches: result.matches.filter((m) => m.action === "censor"),
        matchedCount: result.matchedCount,
        needsConfirm,
        punctuationPolished,
        aiPolishStatus,
        aiModerationStatus: aiStatus,
        moderationSource,
        censoredWords: changes.length,
        geminiQuotaExceeded: geminiQuotaBlocked(),
        ...(sourceField ? { sourceField } : {}),
      },
    };
  } catch (e) {
    const blocked = moderationBlockedHttpBody(e);
    if (blocked) {
      return {
        status: 400 as const,
        body: { ...blocked, blocked: true, originalText: text, cleanText: text, changes: [] },
      };
    }
    return {
      status: 500 as const,
      body: { error: e instanceof Error ? e.message : "Ошибка модерации" },
    };
  }
}
