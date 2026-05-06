import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { buildStoredCommentReportText } from "@/lib/comment-report-labels";
import { clampModerationText } from "@/lib/moderation-text-limit";
import { tagCommentReportReason } from "@/lib/content-report-storage";
import { resolveUserUuid } from "@/lib/user-utils";
import { db } from "@/server/db";
import { comments, contentReports } from "@/server/db/schema";
import type { CommentReportReasonCategory } from "@/server/db/schema";

export const runtime = "nodejs";

const ALLOWED: CommentReportReasonCategory[] = ["insult", "hate", "spam", "custom"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  try {
    const { commentId } = await params;
    if (!commentId?.trim()) {
      return NextResponse.json({ error: "Некорректный комментарий" }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
    }

    const reporterId = await resolveUserUuid(session);
    if (!reporterId) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 401 });
    }

    let body: {
      category?: string;
      extraDetail?: string;
      customText?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    const category = body.category as CommentReportReasonCategory;
    if (!category || !ALLOWED.includes(category)) {
      return NextResponse.json({ error: "Выберите причину жалобы" }, { status: 400 });
    }

    const extraDetail = clampModerationText(String(body.extraDetail ?? "").trim());
    const customText = clampModerationText(String(body.customText ?? "").trim());

    if (category === "custom") {
      if (customText.length < 8) {
        return NextResponse.json(
          { error: "Опишите проблему подробнее (не меньше 8 символов)" },
          { status: 400 }
        );
      }
    }

    const row = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      columns: { id: true, authorId: true, deletedAt: true },
    });

    if (!row) {
      return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 });
    }

    if (row.deletedAt) {
      return NextResponse.json({ error: "Комментарий уже удалён" }, { status: 400 });
    }

    if (row.authorId === reporterId) {
      return NextResponse.json({ error: "Нельзя пожаловаться на свой комментарий" }, { status: 400 });
    }

    const reasonBody =
      category === "custom"
        ? customText
        : buildStoredCommentReportText(category, extraDetail);

    const reasonStored = clampModerationText(tagCommentReportReason(category, reasonBody));

    await db.insert(contentReports).values({
      reporterId,
      targetType: "comment",
      targetId: row.id,
      reason: reasonStored,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST /api/comments/[commentId]/report", e);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
