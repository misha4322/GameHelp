import { NextResponse } from "next/server";
import { and, asc, eq, or } from "drizzle-orm";

import { getStaffContext } from "@/lib/admin-server";
import { isUuidString } from "@/lib/parse-query-ids";
import { db } from "@/server/db";
import { contentReports, posts, users } from "@/server/db/schema";

export const runtime = "nodejs";

/** Панель модерации поста: из очереди жалоб или прямой разбор по slug/id (как by-comment). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ postKey: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const { postKey } = await params;
  const key = postKey?.trim();
  if (!key) {
    return NextResponse.json({ error: "postKey обязателен" }, { status: 400 });
  }

  try {
    const post = await db.query.posts.findFirst({
      where: isUuidString(key)
        ? or(eq(posts.id, key), eq(posts.slug, key))
        : eq(posts.slug, key),
      columns: {
        id: true,
        slug: true,
        title: true,
        content: true,
        authorId: true,
      },
    });
    if (!post) {
      return NextResponse.json({ error: "Пост не найден" }, { status: 404 });
    }

    const [author, reportHead] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, post.authorId),
        columns: { id: true, username: true, role: true },
      }),
      db
        .select({
          id: contentReports.id,
          reason: contentReports.reason,
          createdAt: contentReports.createdAt,
          reporterId: users.id,
          reporterUsername: users.username,
        })
        .from(contentReports)
        .innerJoin(users, eq(contentReports.reporterId, users.id))
        .where(and(eq(contentReports.targetType, "post"), eq(contentReports.targetId, post.id)))
        .orderBy(asc(contentReports.createdAt))
        .limit(1),
    ]);

    const raw = post.content ?? "";
    const contentPreview =
      raw.length > 0 ? raw.slice(0, 280) + (raw.length > 280 ? "…" : "") : null;

    const postAuthor = author
      ? {
          id: author.id,
          username: author.username,
          role: author.role ?? "user",
        }
      : { id: post.authorId, username: "—", role: "user" as const };

    const postContext = {
      postId: post.id,
      slug: post.slug,
      title: post.title,
      author: postAuthor,
      contentPreview,
    };

    const r = reportHead[0];
    if (r) {
      return NextResponse.json({
        report: {
          id: r.id,
          targetType: "post" as const,
          targetId: post.id,
          queueItem: true,
          reasonCategory: null,
          reasonCategoryLabel: null,
          reason: r.reason?.trim() ? r.reason : "—",
          createdAt: r.createdAt?.toISOString?.() ?? null,
          reporter: { id: r.reporterId, username: r.reporterUsername },
          commentAuthor: null,
          reportsAgainstCommentAuthor: null,
          commentContext: null,
          postContext,
        },
      });
    }

    return NextResponse.json({
      report: {
        id: "",
        targetType: "post" as const,
        targetId: post.id,
        queueItem: false,
        reasonCategory: null,
        reasonCategoryLabel: null,
        reason: "Жалоба в очередь не поступала — разбор со страницы поста или из админки.",
        createdAt: null,
        reporter: { id: "—", username: "Прямой разбор" },
        commentAuthor: null,
        reportsAgainstCommentAuthor: null,
        commentContext: null,
        postContext,
      },
    });
  } catch (e) {
    console.error("GET /api/admin/moderation/by-post/[postKey]", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
