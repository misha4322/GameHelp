import { and, eq, or } from "drizzle-orm";

import type { ModerationTextMatch } from "../lib/moderation/moderate-text";
import { db } from "./db";
import { moderationEvents, moderationWords } from "./db/schema";
import type { ModerationRule, ModerationScope } from "../lib/moderation/moderate-text";
import { moderateText } from "../lib/moderation/moderate-text";

const DEFAULT_BLOCK_MESSAGE =
  "Текст содержит запрещённые выражения. Исправьте подчёркнутые слова.";

export class ModerationBlockedError extends Error {
  readonly code = "MODERATION_BLOCKED" as const;

  constructor(
    public readonly matches: ModerationTextMatch[],
    message: string = DEFAULT_BLOCK_MESSAGE,
    public readonly sourceField?: string
  ) {
    super(message);
    this.name = "ModerationBlockedError";
  }
}

export function isModerationBlockedError(e: unknown): e is ModerationBlockedError {
  return e instanceof ModerationBlockedError;
}

export function moderationBlockedHttpBody(e: unknown): {
  error: string;
  code: string;
  matches: ModerationTextMatch[];
  sourceField?: string;
} | null {
  if (!isModerationBlockedError(e)) return null;
  return {
    error: e.message,
    code: e.code,
    matches: e.matches,
    ...(e.sourceField ? { sourceField: e.sourceField } : {}),
  };
}

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
  /** Подсказка фронту: в каком поле сработала блокировка (заголовок, текст поста, профиль и т.д.) */
  blockSourceField?: string;
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
    const blockMatches = result.matches.filter((m) => m.action === "block");
    throw new ModerationBlockedError(blockMatches, undefined, params.blockSourceField);
  }

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
