import { and, eq, or } from "drizzle-orm";

import { db } from "./db";
import { moderationEvents, moderationWords } from "./db/schema";
import type { ModerationRule, ModerationScope } from "../lib/moderation/moderate-text";
import { moderateText } from "../lib/moderation/moderate-text";

export async function loadActiveModerationRules(scope: ModerationScope): Promise<ModerationRule[]> {
  const rows = await db.query.moderationWords.findMany({
    where: and(
      eq(moderationWords.isActive, true),
      or(eq(moderationWords.scope, "all"), eq(moderationWords.scope, scope))
    ),
    columns: {
      id: true,
      phrase: true,
      normalizedPhrase: true,
      action: true,
      scope: true,
      severity: true,
      replacement: true,
      isActive: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    phrase: r.phrase,
    normalizedPhrase: r.normalizedPhrase,
    action: r.action,
    scope: r.scope,
    severity: r.severity,
    replacement: r.replacement,
    isActive: r.isActive,
  }));
}

export type ModerationApplyParams = {
  userId: string;
  targetType: "post" | "comment" | "message" | "profile";
  targetId: string | null;
  scope: ModerationScope;
  text: string;
};

export async function applyModerationOrThrow(params: ModerationApplyParams) {
  const rules = await loadActiveModerationRules(params.scope);
  const result = moderateText(params.text, rules, params.scope);

  if (result.action === "none") {
    return { result, cleanText: params.text };
  }

  if (result.blocked) {
    await db.insert(moderationEvents).values({
      userId: params.userId,
      targetType: params.targetType,
      targetId: params.targetId,
      action: "block",
      scope: params.scope,
      matchedCount: result.matchedCount,
      createdAt: new Date(),
    });
    const err = new Error("Текст содержит запрещённые выражения и не может быть опубликован");
    (err as Error & { code?: string }).code = "MODERATION_BLOCKED";
    throw err;
  }

  // censor
  const cleanText = result.cleanText;
  if (params.targetId) {
    await db.insert(moderationEvents).values({
      userId: params.userId,
      targetType: params.targetType,
      targetId: params.targetId,
      action: "censor",
      scope: params.scope,
      matchedCount: result.matchedCount,
      createdAt: new Date(),
    });
  }

  return { result, cleanText };
}

export async function logModerationEvent(params: {
  userId: string;
  targetType: "post" | "comment" | "message" | "profile";
  targetId: string | null;
  action: "censor" | "block";
  scope: ModerationScope;
  matchedCount: number;
}) {
  await db.insert(moderationEvents).values({
    userId: params.userId,
    targetType: params.targetType,
    targetId: params.targetId,
    action: params.action,
    scope: params.scope,
    matchedCount: params.matchedCount,
    createdAt: new Date(),
  });
}

