import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { checkUserPostingBan } from "@/lib/user-ban";
import { db } from "@/server/db";
import { comments, users } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";

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

    await db
      .update(comments)
      .set({
        content: content.slice(0, MAX_COMMENT_LEN),
        editedAt: new Date(),
        editedByStaffId: null,
      })
      .where(and(eq(comments.id, commentId), eq(comments.authorId, userId)));

    return NextResponse.json({ ok: true });
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
