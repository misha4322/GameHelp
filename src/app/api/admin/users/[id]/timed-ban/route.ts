import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getStaffContext } from "@/lib/admin-server";
import { BAN_IMMUNE_MESSAGE, isBanImmuneRole } from "@/lib/roles";
import { resolveUserUuid } from "@/lib/user-utils";
import { banDurationToMs, isBanDurationKey, type BanDurationKey } from "@/lib/ban-durations";
import { clampModerationText } from "@/lib/moderation-text-limit";
import { db } from "@/server/db";
import { userWarnings, users } from "@/server/db/schema";

export const runtime = "nodejs";

/** Временный бан по сроку + опционально предупреждение в ЛК (без удаления комментария). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const staffUuid = await resolveUserUuid(c.session);
  if (!staffUuid) {
    return NextResponse.json({ error: "Не удалось определить модератора" }, { status: 401 });
  }

  const { id: targetId } = await params;
  if (!targetId?.trim()) {
    return NextResponse.json({ error: "id обязателен" }, { status: 400 });
  }
  if (targetId === staffUuid) {
    return NextResponse.json({ error: "Нельзя банить себя" }, { status: 400 });
  }

  let body: { duration?: string; notifyReason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const durationRaw = body.duration;
  if (!durationRaw || !isBanDurationKey(durationRaw)) {
    return NextResponse.json({ error: "Выберите срок блокировки" }, { status: 400 });
  }
  const duration = durationRaw as BanDurationKey;

  const notifyReason = String(body.notifyReason ?? "").trim();

  try {
    const target = await db.query.users.findFirst({
      where: eq(users.id, targetId),
      columns: { id: true, role: true, bannedUntil: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }
    if (isBanImmuneRole(target.role)) {
      return NextResponse.json({ error: BAN_IMMUNE_MESSAGE }, { status: 403 });
    }

    const now = new Date();
    const ms = banDurationToMs(duration);
    const proposedEnd = now.getTime() + ms;
    let nextEnd = proposedEnd;
    if (target.bannedUntil && target.bannedUntil.getTime() > now.getTime()) {
      nextEnd = Math.max(proposedEnd, target.bannedUntil.getTime());
    }

    await db
      .update(users)
      .set({
        bannedUntil: new Date(nextEnd),
        isBanned: true,
      })
      .where(eq(users.id, targetId));

    if (notifyReason) {
      await db.insert(userWarnings).values({
        userId: targetId,
        commentId: null,
        commentSnapshot: null,
        reason: clampModerationText(notifyReason),
        createdByStaffId: staffUuid,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST /api/admin/users/[id]/timed-ban", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
