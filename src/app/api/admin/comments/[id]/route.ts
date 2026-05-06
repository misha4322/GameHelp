import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getStaffContext } from "@/lib/admin-server";
import { db } from "@/server/db";
import { comments } from "@/server/db/schema";
import { removeReportsForComment } from "@/server/report-queue";

export const runtime = "nodejs";

/** Мягкое удаление (ответы сохраняются) */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const { id } = await params;
  const commentId = id.trim();
  if (!commentId) {
    return NextResponse.json({ error: "id комментария обязателен" }, { status: 400 });
  }

  try {
    const target = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      columns: { id: true, deletedAt: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 });
    }

    if (target.deletedAt) {
      await removeReportsForComment(target.id);
      return NextResponse.json({ ok: true });
    }

    await db
      .update(comments)
      .set({
        deletedAt: new Date(),
        deletedById: c.userId,
        content: "",
      })
      .where(eq(comments.id, target.id));

    await removeReportsForComment(target.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/admin/comments/[id]", e);
    return NextResponse.json({ error: "Ошибка удаления комментария" }, { status: 500 });
  }
}

/** Текст комментария меняет только автор: PATCH /api/comments/[commentId] */
export async function PATCH() {
  return NextResponse.json(
    { error: "Текст комментария может изменить только его автор" },
    { status: 403 }
  );
}
