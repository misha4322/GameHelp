import { and, asc, count, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getStaffContext } from "@/lib/admin-server";
import { parseTaggedCommentReportReason } from "@/lib/content-report-storage";
import { db } from "@/server/db";
import { comments, contentReports, posts, users } from "@/server/db/schema";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 80));

    const rows = await db
      .select({
        id: contentReports.id,
        targetType: contentReports.targetType,
        targetId: contentReports.targetId,
        reason: contentReports.reason,
        createdAt: contentReports.createdAt,
        reporterId: contentReports.reporterId,
        reporterUsername: users.username,
        commentPostSlug: posts.slug,
        commentPostTitle: posts.title,
        commentPreview: comments.content,
        commentAuthorId: comments.authorId,
      })
      .from(contentReports)
      .innerJoin(users, eq(contentReports.reporterId, users.id))
      .leftJoin(
        comments,
        and(eq(contentReports.targetType, "comment"), eq(contentReports.targetId, comments.id))
      )
      .leftJoin(posts, eq(comments.postId, posts.id))
      .orderBy(asc(contentReports.createdAt))
      .limit(limit);

    const authorIds = [
      ...new Set(
        rows.map((r) => r.commentAuthorId).filter((id): id is string => typeof id === "string" && !!id)
      ),
    ];

    const authorMap = new Map<string, { username: string; role: string }>();
    let reportCountByAuthor = new Map<string, number>();

    if (authorIds.length) {
      const authorRows = await db
        .select({ id: users.id, username: users.username, role: users.role })
        .from(users)
        .where(inArray(users.id, authorIds));
      for (const a of authorRows) {
        authorMap.set(a.id, { username: a.username, role: a.role ?? "user" });
      }

      const agg = await db
        .select({
          authorId: comments.authorId,
          n: count(),
        })
        .from(contentReports)
        .innerJoin(
          comments,
          and(eq(contentReports.targetType, "comment"), eq(contentReports.targetId, comments.id))
        )
        .where(inArray(comments.authorId, authorIds))
        .groupBy(comments.authorId);

      for (const row of agg) {
        reportCountByAuthor.set(row.authorId, Number(row.n));
      }
    }

    const postIds = [
      ...new Set(rows.filter((r) => r.targetType === "post").map((r) => r.targetId)),
    ];
    const postMap = new Map<
      string,
      {
        id: string;
        slug: string;
        title: string;
        content: string;
        authorId: string;
        authorUsername: string;
        authorRole: string;
      }
    >();
    if (postIds.length) {
      const postRows = await db
        .select({
          id: posts.id,
          slug: posts.slug,
          title: posts.title,
          content: posts.content,
          authorId: posts.authorId,
          authorUsername: users.username,
          authorRole: users.role,
        })
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .where(inArray(posts.id, postIds));
      for (const p of postRows) {
        postMap.set(p.id, p);
      }
    }

    const list = rows.map((r) => {
      const parsed =
        r.targetType === "comment"
          ? parseTaggedCommentReportReason(r.reason)
          : { category: null, body: r.reason ?? "", categoryLabel: null as string | null };
      const reasonDisplay =
        r.targetType === "comment" && parsed.body.trim() ? parsed.body : r.reason;

      const aid = r.commentAuthorId;
      const authorInfo = aid ? authorMap.get(aid) : undefined;
      const commentAuthor =
        r.targetType === "comment" && aid
          ? {
              id: aid,
              username: authorInfo?.username ?? "—",
              role: authorInfo?.role ?? "user",
            }
          : null;

      return {
        id: r.id,
        queueItem: true,
        targetType: r.targetType,
        targetId: r.targetId,
        reasonCategory: parsed.category,
        reasonCategoryLabel: parsed.categoryLabel,
        reason: reasonDisplay,
        createdAt: r.createdAt?.toISOString?.() ?? null,
        reporter: { id: r.reporterId, username: r.reporterUsername },
        commentAuthor,
        reportsAgainstCommentAuthor:
          r.targetType === "comment" && aid ? reportCountByAuthor.get(aid) ?? 0 : null,
        commentContext:
          r.targetType === "comment"
            ? {
                postSlug: r.commentPostSlug ?? null,
                postTitle: r.commentPostTitle ?? null,
                preview: r.commentPreview
                  ? r.commentPreview.slice(0, 280) + (r.commentPreview.length > 280 ? "…" : "")
                  : null,
              }
            : null,
        postContext:
          r.targetType === "post"
            ? (() => {
                const p = postMap.get(r.targetId);
                if (!p) return null;
                const raw = p.content ?? "";
                const preview =
                  raw.length > 0
                    ? raw.slice(0, 280) + (raw.length > 280 ? "…" : "")
                    : null;
                return {
                  postId: p.id,
                  slug: p.slug,
                  title: p.title,
                  author: {
                    id: p.authorId,
                    username: p.authorUsername,
                    role: p.authorRole ?? "user",
                  },
                  contentPreview: preview,
                };
              })()
            : null,
      };
    });

    return NextResponse.json({ reports: list });
  } catch (e) {
    console.error("GET /api/admin/reports", e);
    return NextResponse.json({ error: "Ошибка загрузки" }, { status: 500 });
  }
}
