import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { posts, comments, commentLikes, users, contentReports } from "@/server/db/schema";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { isStaffRole } from "@/lib/roles";
import { checkUserPostingBan } from "@/lib/user-ban";
import { resolveUserUuid } from "@/lib/user-utils";
import type { CommentNode } from "@/types/comments";
import { applyModerationWithLogOrThrow, logModerationEvent, moderationBlockedHttpBody } from "@/server/moderation";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> } // ✅ Next 15 требует await
) {
  try {
    const { slug } = await params; // ✅ обязательно await params

    const session = await getServerSession(authOptions);
    const userUuid = session ? await resolveUserUuid(session) : null;
    const viewerStaff = isStaffRole(session?.user?.role ?? "user");

    // 1) находим пост по slug
    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
      columns: { id: true },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const postId = post.id;

    const listQuery = db
      .select({
        id: comments.id,
        postId: comments.postId,
        parentId: comments.parentId,
        content: comments.content,
        createdAt: comments.createdAt,
        deletedAt: comments.deletedAt,
        deletedById: comments.deletedById,
        editedAt: comments.editedAt,
        editedByStaffId: comments.editedByStaffId,
        authorId: comments.authorId,
        authorUserId: users.id,
        authorUsername: users.username,
        authorAvatar: users.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.postId, postId))
      .orderBy(asc(comments.createdAt));

    const countsQuery = db
      .select({
        commentId: commentLikes.commentId,
        type: commentLikes.type,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(commentLikes)
      .innerJoin(comments, eq(commentLikes.commentId, comments.id))
      .where(eq(comments.postId, postId))
      .groupBy(commentLikes.commentId, commentLikes.type);

    const myReactionsQuery =
      userUuid ?
        db
          .select({
            commentId: commentLikes.commentId,
            type: commentLikes.type,
          })
          .from(commentLikes)
          .innerJoin(comments, eq(commentLikes.commentId, comments.id))
          .where(and(eq(comments.postId, postId), eq(commentLikes.userId, userUuid)))
      : Promise.resolve([] as { commentId: string; type: string }[]);

    const reportCountsQuery =
      viewerStaff ?
        db
          .select({
            tid: contentReports.targetId,
            n: count(),
          })
          .from(contentReports)
          .innerJoin(
            comments,
            and(eq(contentReports.targetType, "comment"), eq(contentReports.targetId, comments.id))
          )
          .where(eq(comments.postId, postId))
          .groupBy(contentReports.targetId)
      : Promise.resolve([] as { tid: string; n: unknown }[]);

    const [list, counts, myReactions, reportRows] = await Promise.all([
      listQuery,
      countsQuery,
      myReactionsQuery,
      reportCountsQuery,
    ]);

    if (list.length === 0) {
      return NextResponse.json({ comments: [] as CommentNode[] });
    }

    const likeCountMap = new Map<string, number>();
    const dislikeCountMap = new Map<string, number>();

    for (const row of counts) {
      const n = Number(row.count) || 0;
      if (row.type === "like") likeCountMap.set(row.commentId, n);
      if (row.type === "dislike") dislikeCountMap.set(row.commentId, n);
    }

    const myLikeSet = new Set(
      myReactions.filter((r) => r.type === "like").map((r) => r.commentId)
    );
    const myDislikeSet = new Set(
      myReactions.filter((r) => r.type === "dislike").map((r) => r.commentId)
    );

    const reportCountMap = new Map<string, number>();
    if (viewerStaff) {
      for (const row of reportRows) {
        reportCountMap.set(row.tid, Number(row.n));
      }
    }

    const nodeMap = new Map<string, CommentNode>();

    for (const c of list) {
      const isDeleted = !!c.deletedAt;
      const deletedBySelf = isDeleted && c.deletedById === c.authorId;
      const editedByStaff = !!c.editedAt && !!c.editedByStaffId;

      const authorOut: CommentNode["author"] = {
        id: c.authorUserId,
        username: c.authorUsername,
        avatarUrl: c.authorAvatar ?? null,
      };

      /** Тексты для удалённых комментариев подставляет клиент (зависят от зрителя) */
      const contentOut = isDeleted ? "" : c.content;

      nodeMap.set(c.id, {
        id: c.id,
        postId: c.postId,
        parentId: c.parentId,
        content: contentOut,
        createdAt: c.createdAt ? c.createdAt.toISOString() : null,
        author: authorOut,
        likeCount: likeCountMap.get(c.id) ?? 0,
        dislikeCount: dislikeCountMap.get(c.id) ?? 0,
        likedByMe: myLikeSet.has(c.id),
        dislikedByMe: myDislikeSet.has(c.id),
        replies: [],
        isDeleted,
        deletedBySelf,
        editedByStaff,
        ...(viewerStaff ? { staffReportCount: reportCountMap.get(c.id) ?? 0 } : {}),
      });
    }

    const roots: CommentNode[] = [];

    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.replies.push(node);
      } else {
        roots.push(node);
      }
    }

    return NextResponse.json({ comments: roots });
  } catch (e) {
    console.error("GET /api/posts/[slug]/comments error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> } // ✅ Next 15 требует await
) {
  try {
    const { slug } = await params; // ✅ обязательно await params

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = await resolveUserUuid(session);
    if (!userId) {
      return NextResponse.json(
        { error: "User not found (bad session id)" },
        { status: 401 }
      );
    }

    const me = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { bannedUntil: true, isBanned: true },
    });
    const ban = checkUserPostingBan(me);
    if (!ban.ok) {
      return NextResponse.json({ error: ban.error }, { status: 403 });
    }

    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
      columns: { id: true },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const body = await req.json();
    const content = String(body.content ?? "").trim();
    const parentId = body.parentId ? String(body.parentId) : null;

    if (!content) {
      return NextResponse.json({ error: "Пустой комментарий" }, { status: 400 });
    }

    let cleanContent = content;
    let wasCensored = false;
    let matchedCount = 0;
    let changes: unknown[] = [];
    try {
      const m = await applyModerationWithLogOrThrow({
        userId,
        targetType: "comment",
        targetId: null,
        scope: "comments",
        text: content,
        blockSourceField: "comment",
      });
      cleanContent = m.cleanText;
      wasCensored = m.result.censored;
      matchedCount = m.result.matchedCount;
      changes = m.changes;
    } catch (e) {
      const blocked = moderationBlockedHttpBody(e);
      if (blocked) {
        return NextResponse.json(blocked, { status: 400 });
      }
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Комментарий не прошёл модерацию" },
        { status: 400 }
      );
    }

    // проверка parentId (если это ответ)
    if (parentId) {
      const parent = await db.query.comments.findFirst({
        where: eq(comments.id, parentId),
        columns: { id: true, postId: true },
      });

      if (!parent || parent.postId !== post.id) {
        return NextResponse.json(
          { error: "Некорректный parentId" },
          { status: 400 }
        );
      }
    }

    const inserted = await db
      .insert(comments)
      .values({
        postId: post.id,
        authorId: userId,
        content: cleanContent,
        parentId,
      })
      .returning();

    const row = inserted[0];
    if (wasCensored && row?.id) {
      await logModerationEvent({
        userId,
        targetType: "comment",
        targetId: row.id,
        action: "censor",
        scope: "comments",
        matchedCount,
      });
    }

    return NextResponse.json({
      success: true,
      comment: row,
      moderation: wasCensored ? { matchedCount, changes } : { matchedCount: 0, changes: [] },
    });
  } catch (e) {
    console.error("POST /api/posts/[slug]/comments error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
