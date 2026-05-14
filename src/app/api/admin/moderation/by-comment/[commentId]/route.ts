import { NextResponse } from "next/server";
import { and, asc, count, eq } from "drizzle-orm";

import { getStaffContext } from "@/lib/admin-server";
import { parseTaggedCommentReportReason } from "@/lib/content-report-storage";
import { db } from "@/server/db";
import { comments, contentReports, posts, users } from "@/server/db/schema";

export const runtime = "nodejs";


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const { commentId } = await params;
  if (!commentId?.trim()) {
    return NextResponse.json({ error: "commentId обязателен" }, { status: 400 });
  }

  try {
    const com = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      columns: { id: true, content: true, authorId: true, postId: true },
    });
    if (!com) {
      return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 });
    }

    const [author, post, reportHead, authorReportAgg] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, com.authorId),
        columns: { id: true, username: true, role: true },
      }),
      db.query.posts.findFirst({
        where: eq(posts.id, com.postId),
        columns: { slug: true, title: true },
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
        .where(and(eq(contentReports.targetType, "comment"), eq(contentReports.targetId, commentId)))
        .orderBy(asc(contentReports.createdAt))
        .limit(1),
      db
        .select({ n: count() })
        .from(contentReports)
        .innerJoin(
          comments,
          and(eq(contentReports.targetType, "comment"), eq(contentReports.targetId, comments.id))
        )
        .where(eq(comments.authorId, com.authorId)),
    ]);

    const reportsAgainstCommentAuthor = Number(authorReportAgg[0]?.n ?? 0);
    const r = reportHead[0];

    const commentContext = {
      postSlug: post?.slug ?? null,
      postTitle: post?.title ?? null,
      preview: com.content
        ? com.content.slice(0, 280) + (com.content.length > 280 ? "…" : "")
        : null,
    };

    const commentAuthor = author
      ? { id: author.id, username: author.username, role: author.role ?? "user" }
      : { id: com.authorId, username: "—", role: "user" as const };

    if (r) {
      const parsed = parseTaggedCommentReportReason(r.reason);
      const reasonDisplay =
        parsed.body.trim() ? parsed.body : (r.reason ?? "");

      return NextResponse.json({
        report: {
          id: r.id,
          targetType: "comment",
          targetId: commentId,
          queueItem: true,
          reasonCategory: parsed.category,
          reasonCategoryLabel: parsed.categoryLabel,
          reason: reasonDisplay,
          createdAt: r.createdAt?.toISOString?.() ?? null,
          reporter: { id: r.reporterId, username: r.reporterUsername },
          commentAuthor,
          reportsAgainstCommentAuthor,
          commentContext,
          postContext: null,
        },
      });
    }

    return NextResponse.json({
      report: {
        id: "",
        targetType: "comment",
        targetId: commentId,
        queueItem: false,
        reasonCategory: null,
        reasonCategoryLabel: null,
        reason: "Жалоба в очередь не поступала — разбор с страницы поста.",
        createdAt: null,
        reporter: { id: "—", username: "Прямой разбор" },
        commentAuthor,
        reportsAgainstCommentAuthor,
        commentContext,
        postContext: null,
      },
    });
  } catch (e) {
    console.error("GET /api/admin/moderation/by-comment/[commentId]", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
