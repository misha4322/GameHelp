import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { clampModerationText } from "@/lib/moderation-text-limit";
import { getStaffContext } from "@/lib/admin-server";
import { BAN_IMMUNE_MESSAGE, isBanImmuneRole } from "@/lib/roles";
import { banDurationToMs, isBanDurationKey, type BanDurationKey } from "@/lib/ban-durations";
import { db } from "@/server/db";
import { comments, userWarnings, users } from "@/server/db/schema";
import { removeReportsForComment } from "@/server/services/report-queue";

export const runtime = "nodejs";

type ModerateAction = "delete_only" | "warn_and_delete" | "ban_and_delete";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const { id: commentId } = await params;
  if (!commentId?.trim()) {
    return NextResponse.json({ error: "id комментария обязателен" }, { status: 400 });
  }

  let body: {
    action?: ModerateAction;
    reason?: string;
    banDuration?: BanDurationKey;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const action = body.action;
  const reason = clampModerationText(String(body.reason ?? "").trim());
  const banDuration = body.banDuration;

  if (action !== "delete_only" && action !== "warn_and_delete" && action !== "ban_and_delete") {
    return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
  }

  if ((action === "warn_and_delete" || action === "ban_and_delete") && !reason) {
    return NextResponse.json(
      { error: "Укажите причину для предупреждения или блокировки" },
      { status: 400 }
    );
  }

  if (action === "ban_and_delete") {
    if (!banDuration || !isBanDurationKey(banDuration)) {
      return NextResponse.json({ error: "Выберите срок блокировки" }, { status: 400 });
    }
  }

  try {
    const target = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      columns: {
        id: true,
        postId: true,
        authorId: true,
        content: true,
        parentId: true,
        deletedAt: true,
      },
    });

    if (!target) {
      return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 });
    }

    if (target.deletedAt) {
      return NextResponse.json({ error: "Комментарий уже удалён" }, { status: 400 });
    }

    if (action === "ban_and_delete") {
      const author = await db.query.users.findFirst({
        where: eq(users.id, target.authorId),
        columns: { role: true },
      });
      if (isBanImmuneRole(author?.role)) {
        return NextResponse.json({ error: BAN_IMMUNE_MESSAGE }, { status: 403 });
      }
    }

    const staffId = c.userId;
    const now = new Date();

    if (action === "warn_and_delete" || action === "ban_and_delete") {
      await db.insert(userWarnings).values({
        userId: target.authorId,
        commentId: target.id,
        commentSnapshot: target.content.slice(0, 8000),
        reason,
        createdByStaffId: staffId,
      });
    }

    if (action === "ban_and_delete" && banDuration) {
      const ms = banDurationToMs(banDuration);
      const until = new Date(now.getTime() + ms);

      const victim = await db.query.users.findFirst({
        where: eq(users.id, target.authorId),
        columns: { id: true, bannedUntil: true },
      });

      if (victim) {
        const proposedEnd = until.getTime();
        let nextEnd = proposedEnd;
        if (victim.bannedUntil && victim.bannedUntil.getTime() > now.getTime()) {
          nextEnd = Math.max(proposedEnd, victim.bannedUntil.getTime());
        }
        await db
          .update(users)
          .set({
            bannedUntil: new Date(nextEnd),
            isBanned: true,
          })
          .where(eq(users.id, target.authorId));
      }
    }

    await db
      .update(comments)
      .set({
        deletedAt: now,
        deletedById: staffId,
        content: "",
      })
      .where(eq(comments.id, target.id));

    await removeReportsForComment(target.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST /api/admin/comments/[id]/moderate", e);
    return NextResponse.json({ error: "Ошибка модерации" }, { status: 500 });
  }
}
