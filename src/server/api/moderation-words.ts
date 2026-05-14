import { Elysia, t } from "elysia";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";
import { moderationWords, users } from "../db/schema";
import {
  MIN_MODERATION_PHRASE_CHARS,
  type ModerationAction,
  type ModerationScope,
  type ModerationSeverity,
} from "../../lib/moderation/moderate-text";
import { maskModerationPhrase, normalizeForModeration } from "../../lib/moderation/normalize";
import { isAdminRole } from "../../lib/roles";

async function requireAdminOrThrow(userId: string) {
  const me = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  });
  if (!me || !isAdminRole(me.role)) {
    throw new Error("Доступ только для администратора");
  }
}

const actionSchema = t.Union([t.Literal("censor"), t.Literal("block")]);
const scopeSchema = t.Union([
  t.Literal("all"),
  t.Literal("posts"),
  t.Literal("comments"),
  t.Literal("messages"),
  t.Literal("profile"),
]);
const severitySchema = t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high")]);

function splitBulkPhrases(raw: string): string[] {
  return raw
    .split(/[\r\n,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** block → только high; censor → не high (понижаем до medium). */
function normalizeActionSeverity(
  action: ModerationAction,
  severity: ModerationSeverity
): { action: ModerationAction; severity: ModerationSeverity } {
  if (action === "block") {
    return { action: "block", severity: "high" };
  }
  if (severity === "high") {
    return { action: "censor", severity: "medium" };
  }
  return { action, severity };
}

export const moderationWordsRouter = new Elysia({ prefix: "/moderation" })
  .get(
    "/words",
    async ({ query, set }) => {
      try {
        await requireAdminOrThrow(query.userId);
      } catch (e) {
        set.status = 403;
        return { error: e instanceof Error ? e.message : "Forbidden" };
      }

      const rows = await db.query.moderationWords.findMany({
        orderBy: [asc(moderationWords.createdAt)],
      });

      const reveal = query.reveal === "true";

      return {
        words: rows.map((r) => ({
          id: r.id,
          phrase: reveal ? r.phrase : null,
          maskedPhrase: maskModerationPhrase(r.phrase),
          action: r.action as ModerationAction,
          scope: r.scope as ModerationScope,
          severity: r.severity as ModerationSeverity,
          replacement: r.replacement,
          isActive: r.isActive,
          createdAt: r.createdAt?.toISOString?.() ?? null,
          updatedAt: r.updatedAt?.toISOString?.() ?? null,
          createdById: r.createdById ?? null,
          updatedById: r.updatedById ?? null,
        })),
      };
    },
    {
      query: t.Object({
        userId: t.String(),
        reveal: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/words/:id",
    async ({ params, query, set }) => {
      try {
        await requireAdminOrThrow(query.userId);
      } catch (e) {
        set.status = 403;
        return { error: e instanceof Error ? e.message : "Forbidden" };
      }

      const row = await db.query.moderationWords.findFirst({
        where: eq(moderationWords.id, params.id),
      });
      if (!row) {
        set.status = 404;
        return { error: "Не найдено" };
      }

      return {
        word: {
          id: row.id,
          phrase: row.phrase,
          maskedPhrase: maskModerationPhrase(row.phrase),
          action: row.action as ModerationAction,
          scope: row.scope as ModerationScope,
          severity: row.severity as ModerationSeverity,
          replacement: row.replacement,
          isActive: row.isActive,
          createdAt: row.createdAt?.toISOString?.() ?? null,
          updatedAt: row.updatedAt?.toISOString?.() ?? null,
          createdById: row.createdById ?? null,
          updatedById: row.updatedById ?? null,
        },
      };
    },
    {
      query: t.Object({
        userId: t.String(),
      }),
    }
  )
  .post(
    "/words",
    async ({ body, set }) => {
      try {
        await requireAdminOrThrow(body.userId);
      } catch (e) {
        set.status = 403;
        return { error: e instanceof Error ? e.message : "Forbidden" };
      }

      const phrase = body.phrase.trim();
      if (!phrase) {
        set.status = 400;
        return { error: "Введите слово или фразу" };
      }

      const normalized = normalizeForModeration(phrase);
      if (!normalized) {
        set.status = 400;
        return { error: "Фраза не подходит для модерации (после нормализации пусто)" };
      }
      if (normalized.length < MIN_MODERATION_PHRASE_CHARS) {
        set.status = 400;
        return {
          error: `Минимум ${MIN_MODERATION_PHRASE_CHARS} символа после нормализации (короткие правила дают ложные блокировки текста)`,
        };
      }

      const { action, severity } = normalizeActionSeverity(body.action, body.severity);

      const dup = await db.query.moderationWords.findFirst({
        where: and(
          eq(moderationWords.normalizedPhrase, normalized),
          eq(moderationWords.scope, body.scope)
        ),
        columns: { id: true },
      });
      if (dup) {
        return { success: true, id: dup.id, skippedDuplicate: true as const };
      }

      const inserted = await db
        .insert(moderationWords)
        .values({
          phrase,
          normalizedPhrase: normalized,
          action,
          scope: body.scope,
          severity,
          replacement: body.replacement?.trim() || "...",
          isActive: body.isActive ?? true,
          createdById: body.userId,
          updatedById: body.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: moderationWords.id });

      return { success: true, id: inserted[0]?.id ?? null };
    },
    {
      body: t.Object({
        userId: t.String(),
        phrase: t.String(),
        action: actionSchema,
        scope: scopeSchema,
        severity: severitySchema,
        replacement: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )

  .post(
    "/words/bulk",
    async ({ body, set }) => {
      try {
        await requireAdminOrThrow(body.userId);
      } catch (e) {
        set.status = 403;
        return { error: e instanceof Error ? e.message : "Forbidden" };
      }

      const raw = body.phrasesRaw.trim();
      if (!raw) {
        set.status = 400;
        return { error: "Вставьте список слов/фраз" };
      }

      const parts = splitBulkPhrases(raw);
      if (parts.length === 0) {
        set.status = 400;
        return { error: "Не удалось распознать слова/фразы" };
      }

      const uniqueByNormalized = new Map<string, string>();
      for (const phrase of parts) {
        const normalized = normalizeForModeration(phrase);
        if (!normalized || normalized.length < MIN_MODERATION_PHRASE_CHARS) continue;
        if (!uniqueByNormalized.has(normalized)) {
          uniqueByNormalized.set(normalized, phrase);
        }
      }

      const normalizedList = Array.from(uniqueByNormalized.keys());
      if (normalizedList.length === 0) {
        set.status = 400;
        return { error: "После нормализации список пуст" };
      }

      const existing = await db.query.moderationWords.findMany({
        columns: { normalizedPhrase: true, scope: true },
      });
      const existingSet = new Set(existing.map((r) => `${r.normalizedPhrase}\t${r.scope}`));

      const { action, severity } = normalizeActionSeverity(body.action, body.severity);
      const scopeKey = body.scope;

      const toInsert = normalizedList
        .filter((n) => !existingSet.has(`${n}\t${scopeKey}`))
        .map((normalized) => {
          const phrase = uniqueByNormalized.get(normalized)!;
          return {
            phrase,
            normalizedPhrase: normalized,
            action,
            scope: body.scope,
            severity,
            replacement: body.replacement?.trim() || "...",
            isActive: body.isActive ?? true,
            createdById: body.userId,
            updatedById: body.userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        });

      if (toInsert.length > 0) {
        await db.insert(moderationWords).values(toInsert);
      }

      return {
        success: true,
        received: parts.length,
        normalized: normalizedList.length,
        inserted: toInsert.length,
        skippedExisting: normalizedList.length - toInsert.length,
      };
    },
    {
      body: t.Object({
        userId: t.String(),
        phrasesRaw: t.String(),
        action: actionSchema,
        scope: scopeSchema,
        severity: severitySchema,
        replacement: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )
  .patch(
    "/words/:id",
    async ({ params, body, set }) => {
      try {
        await requireAdminOrThrow(body.userId);
      } catch (e) {
        set.status = 403;
        return { error: e instanceof Error ? e.message : "Forbidden" };
      }

      const phrase = body.phrase.trim();
      if (!phrase) {
        set.status = 400;
        return { error: "Введите слово или фразу" };
      }

      const normalized = normalizeForModeration(phrase);
      if (!normalized) {
        set.status = 400;
        return { error: "Фраза не подходит для модерации (после нормализации пусто)" };
      }
      if (normalized.length < MIN_MODERATION_PHRASE_CHARS) {
        set.status = 400;
        return {
          error: `Минимум ${MIN_MODERATION_PHRASE_CHARS} символа после нормализации (короткие правила дают ложные блокировки текста)`,
        };
      }

      const { action, severity } = normalizeActionSeverity(body.action, body.severity);

      const updated = await db
        .update(moderationWords)
        .set({
          phrase,
          normalizedPhrase: normalized,
          action,
          scope: body.scope,
          severity,
          replacement: body.replacement?.trim() || "...",
          isActive: body.isActive,
          updatedById: body.userId,
          updatedAt: new Date(),
        })
        .where(eq(moderationWords.id, params.id))
        .returning({ id: moderationWords.id });

      if (!updated[0]) {
        set.status = 404;
        return { error: "Не найдено" };
      }

      return { success: true };
    },
    {
      body: t.Object({
        userId: t.String(),
        phrase: t.String(),
        action: actionSchema,
        scope: scopeSchema,
        severity: severitySchema,
        replacement: t.Optional(t.String()),
        isActive: t.Boolean(),
      }),
    }
  )
  .delete(
    "/words/:id",
    async ({ params, query, set }) => {
      try {
        await requireAdminOrThrow(query.userId);
      } catch (e) {
        set.status = 403;
        return { error: e instanceof Error ? e.message : "Forbidden" };
      }

      await db.delete(moderationWords).where(eq(moderationWords.id, params.id));
      return { success: true };
    },
    {
      query: t.Object({
        userId: t.String(),
      }),
    }
  );

