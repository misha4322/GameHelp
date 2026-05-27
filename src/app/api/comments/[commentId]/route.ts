import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { checkUserPostingBan } from "@/lib/user-ban";
import { db } from "@/server/db";
import { comments, users } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";
import { applyModerationWithLogOrThrow, logModerationEvent, moderationBlockedHttpBody } from "@/server/moderation";

export const runtime = "nodejs";

const MAX_COMMENT_LEN = 8000;

/** Автор редактирует свой комментарий */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  try {
    const { commentId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = await resolveUserUuid(session);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    let body: { content?: string };
    try {
      body = (await req.json()) as { content?: string };
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    const content = String(body.content ?? "").trim();
    if (!content) {
      return NextResponse.json({ error: "Пустой текст" }, { status: 400 });
    }

    const me = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { bannedUntil: true, isBanned: true },
    });
    const ban = checkUserPostingBan(me);
    if (!ban.ok) {
      return NextResponse.json({ error: ban.error }, { status: 403 });
    }

    const row = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      columns: { id: true, authorId: true, deletedAt: true },
    });

    if (!row) {
      return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 });
    }

    if (row.authorId !== userId) {
      return NextResponse.json(
        { error: "Редактировать можно только свой комментарий" },
        { status: 403 }
      );
    }

    if (row.deletedAt) {
      return NextResponse.json({ error: "Нельзя редактировать удалённый комментарий" }, { status: 400 });
    }

    let cleanContent = content.slice(0, MAX_COMMENT_LEN);
    let wasCensored = false;
    let matchedCount = 0;
    let changes: unknown[] = [];
    try {
      const m = await applyModerationWithLogOrThrow({
        userId,
        targetType: "comment",
        targetId: row.id,
        scope: "comments",
        text: cleanContent,
        blockSourceField: "comment",
      });
      cleanContent = m.cleanText.slice(0, MAX_COMMENT_LEN);
      wasCensored = m.result.censored;
      matchedCount = m.result.matchedCount;
      changes = m.changes;
    } catch (e) {
      const blocked = moderationBlockedHttpBody(e);
      if (blocked) {
        return NextResponse.json(blocked, { status: 400 });
      }
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Комментарий не прошёл модерацию" },
        { status: 400 }
      );
    }

    await db
      .update(comments)
      .set({
        content: cleanContent,
        editedAt: new Date(),
        editedByStaffId: null,
      })
      .where(and(eq(comments.id, commentId), eq(comments.authorId, userId)));

    if (wasCensored) {
      await logModerationEvent({
        userId,
        targetType: "comment",
        targetId: row.id,
        action: "censor",
        scope: "comments",
        matchedCount,
      });
    }

    return NextResponse.json({
      ok: true,
      moderation: wasCensored ? { matchedCount, changes } : { matchedCount: 0, changes: [] },
    });
  } catch (e) {
    console.error("PATCH /api/comments/[commentId]", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/** Автор удаляет свой комментарий (мягко), ответы остаются */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  try {
    const { commentId } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = await resolveUserUuid(session);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const row = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      columns: { id: true, authorId: true, deletedAt: true },
    });

    if (!row) {
      return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 });
    }

    if (row.authorId !== userId) {
      return NextResponse.json({ error: "Можно удалить только свой комментарий" }, { status: 403 });
    }

    if (row.deletedAt) {
      return NextResponse.json({ ok: true });
    }

    await db
      .update(comments)
      .set({
        deletedAt: new Date(),
        deletedById: userId,
        content: "",
      })
      .where(and(eq(comments.id, commentId), eq(comments.authorId, userId)));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/comments/[commentId]", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
