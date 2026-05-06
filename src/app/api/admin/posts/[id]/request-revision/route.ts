import { NextRequest, NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";

import { clampModerationText } from "@/lib/moderation-text-limit";
import { getStaffContext } from "@/lib/admin-server";
import { isUuidString } from "@/lib/parse-query-ids";
import { db } from "@/server/db";
import { contentReports, posts } from "@/server/db/schema";

export const runtime = "nodejs";

/** Пометить пост для переработки автором и снять с очереди все жалобы на этот пост. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const { id } = await params;
  const key = id.trim();
  if (!key) {
    return NextResponse.json({ error: "id/slug обязателен" }, { status: 400 });
  }

  let note: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { note?: string };
    const raw = typeof body.note === "string" ? body.note.trim() : "";
    note = raw.length ? clampModerationText(raw) : null;
  } catch {
    note = null;
  }

  try {
    const target = await db.query.posts.findFirst({
      where: isUuidString(key)
        ? or(eq(posts.id, key), eq(posts.slug, key))
        : eq(posts.slug, key),
      columns: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Пост не найден" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(posts)
        .set({
          staffRevisionRequestedAt: new Date(),
          staffRevisionNote: note,
        })
        .where(eq(posts.id, target.id));
      await tx
        .delete(contentReports)
        .where(and(eq(contentReports.targetType, "post"), eq(contentReports.targetId, target.id)));
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST /api/admin/posts/[id]/request-revision", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
