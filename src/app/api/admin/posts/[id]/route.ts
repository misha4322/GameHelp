import { NextRequest, NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getStaffContext } from "@/lib/admin-server";
import { isUuidString } from "@/lib/parse-query-ids";
import { db } from "@/server/db";
import { contentReports, posts } from "@/server/db/schema";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const { id } = await params;
  const key = id.trim();
  if (!key) {
    return NextResponse.json({ error: "id/slug обязателен" }, { status: 400 });
  }

  try {
    const target = await db.query.posts.findFirst({
      where: isUuidString(key)
        ? or(eq(posts.id, key), eq(posts.slug, key))
        : eq(posts.slug, key),
      columns: { id: true, slug: true, title: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Пост не найден" }, { status: 404 });
    }

    await db
      .delete(contentReports)
      .where(and(eq(contentReports.targetType, "post"), eq(contentReports.targetId, target.id)));
    await db.delete(posts).where(eq(posts.id, target.id));
    return NextResponse.json({
      ok: true,
      deleted: { id: target.id, slug: target.slug, title: target.title },
    });
  } catch (e) {
    console.error("DELETE /api/admin/posts/[id]", e);
    return NextResponse.json({ error: "Ошибка удаления поста" }, { status: 500 });
  }
}
