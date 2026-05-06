import { Elysia, t } from "elysia";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { checkUserPostingBan } from "@/lib/user-ban";

import { db } from "../db";
import { commentLikes, comments, posts, users } from "../db/schema";
import type { CommentNode } from "../../types/comments";
import { applyModerationOrThrow, logModerationEvent } from "../moderation";

export const commentsRouter = new Elysia()
  .get(
    "/posts/:slug/comments",
    async ({ params, query, set }) => {
      const post = await db.query.posts.findFirst({
        where: eq(posts.slug, params.slug),
        columns: { id: true },
      });

      if (!post) {
        set.status = 404;
        return { error: "Post not found" };
      }

      const list = await db.query.comments.findMany({
        where: eq(comments.postId, post.id),
        orderBy: [asc(comments.createdAt)],
        with: {
          author: true,
        },
      });

      if (list.length === 0) {
        return { comments: [] as CommentNode[] };
      }

      const commentIds = list.map((item) => item.id);

      const counts = await db
        .select({
          commentId: commentLikes.commentId,
          type: commentLikes.type,
          count: sql<number>`count(*)`.as("count"),
        })
        .from(commentLikes)
        .where(inArray(commentLikes.commentId, commentIds))
        .groupBy(commentLikes.commentId, commentLikes.type);

      const myReactions = query.viewerId
        ? await db
            .select({
              commentId: commentLikes.commentId,
              type: commentLikes.type,
            })
            .from(commentLikes)
            .where(
              and(
                inArray(commentLikes.commentId, commentIds),
                eq(commentLikes.userId, query.viewerId)
              )
            )
        : [];

      const likeCountMap = new Map<string, number>();
      const dislikeCountMap = new Map<string, number>();

      for (const row of counts) {
        const value = Number(row.count) || 0;

        if (row.type === "like") likeCountMap.set(row.commentId, value);
        if (row.type === "dislike") dislikeCountMap.set(row.commentId, value);
      }

      const myLikeSet = new Set(
        myReactions
          .filter((row) => row.type === "like")
          .map((row) => row.commentId)
      );

      const myDislikeSet = new Set(
        myReactions
          .filter((row) => row.type === "dislike")
          .map((row) => row.commentId)
      );

      const nodeMap = new Map<string, CommentNode>();

      for (const c of list) {
        const isDeleted = !!c.deletedAt;
        const deletedBySelf = isDeleted && c.deletedById === c.authorId;
        const editedByStaff = !!c.editedAt && !!c.editedByStaffId;

        const authorOut: CommentNode["author"] = {
          id: c.author.id,
          username: c.author.username,
          avatarUrl: c.author.avatarUrl ?? null,
        };

        const contentOut = isDeleted ? "" : c.content;

        nodeMap.set(c.id, {
          id: c.id,
          postId: c.postId,
          parentId: c.parentId,
          content: contentOut,
          createdAt: c.createdAt?.toISOString?.() ?? null,
          author: authorOut,
          likeCount: likeCountMap.get(c.id) ?? 0,
          dislikeCount: dislikeCountMap.get(c.id) ?? 0,
          likedByMe: myLikeSet.has(c.id),
          dislikedByMe: myDislikeSet.has(c.id),
          replies: [],
          isDeleted,
          deletedBySelf,
          editedByStaff,
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

      return { comments: roots };
    },
    {
      query: t.Object({
        viewerId: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/posts/:slug/comments",
    async ({ params, body, set }) => {
      const post = await db.query.posts.findFirst({
        where: eq(posts.slug, params.slug),
        columns: { id: true },
      });

      if (!post) {
        set.status = 404;
        return { error: "Post not found" };
      }

      const content = body.content.trim();

      if (!content) {
        set.status = 400;
        return { error: "Пустой комментарий" };
      }

      let cleanContent = content;
      let matchedCount = 0;
      let censored = false;
      try {
        const m = await applyModerationOrThrow({
          userId: body.userId,
          targetType: "comment",
          targetId: null,
          scope: "comments",
          text: content,
        });
        cleanContent = m.cleanText;
        censored = m.result.censored;
        matchedCount = m.result.matchedCount;
      } catch (e) {
        set.status = 400;
        return { error: e instanceof Error ? e.message : "Комментарий не прошёл модерацию" };
      }

      const me = await db.query.users.findFirst({
        where: eq(users.id, body.userId),
        columns: { bannedUntil: true, isBanned: true },
      });
      const ban = checkUserPostingBan(me);
      if (!ban.ok) {
        set.status = 403;
        return { error: ban.error };
      }

      if (body.parentId) {
        const parent = await db.query.comments.findFirst({
          where: eq(comments.id, body.parentId),
          columns: { id: true, postId: true },
        });

        if (!parent || parent.postId !== post.id) {
          set.status = 400;
          return { error: "Некорректный parentId" };
        }
      }

      const inserted = await db
        .insert(comments)
        .values({
          postId: post.id,
          authorId: body.userId,
          content: cleanContent,
          parentId: body.parentId ?? null,
        })
        .returning();

      const row = inserted[0];
      if (censored && row?.id) {
        await logModerationEvent({
          userId: body.userId,
          targetType: "comment",
          targetId: row.id,
          action: "censor",
          scope: "comments",
          matchedCount,
        });
      }

      return {
        success: true,
        comment: row,
      };
    },
    {
      body: t.Object({
        userId: t.String(),
        content: t.String(),
        parentId: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  .post(
    "/comments/:commentId/reaction",
    async ({ params, body }) => {
      const existing = await db.query.commentLikes.findFirst({
        where: and(
          eq(commentLikes.commentId, params.commentId),
          eq(commentLikes.userId, body.userId)
        ),
        columns: { id: true, type: true },
      });

      if (existing) {
        if (existing.type === body.type) {
          await db.delete(commentLikes).where(eq(commentLikes.id, existing.id));
        } else {
          await db
            .update(commentLikes)
            .set({
              type: body.type,
              createdAt: new Date(),
            })
            .where(eq(commentLikes.id, existing.id));
        }
      } else {
        await db.insert(commentLikes).values({
          commentId: params.commentId,
          userId: body.userId,
          type: body.type,
        });
      }

      return { success: true };
    },
    {
      body: t.Object({
        userId: t.String(),
        type: t.Union([t.Literal("like"), t.Literal("dislike")]),
      }),
    }
  )

  .patch(
    "/comments/:commentId",
    async ({ params, body, set }) => {
      const contentRaw = body.content.trim();
      if (!contentRaw) {
        set.status = 400;
        return { error: "Пустой текст" };
      }

      const me = await db.query.users.findFirst({
        where: eq(users.id, body.userId),
        columns: { bannedUntil: true, isBanned: true },
      });
      const ban = checkUserPostingBan(me);
      if (!ban.ok) {
        set.status = 403;
        return { error: ban.error };
      }

      const row = await db.query.comments.findFirst({
        where: eq(comments.id, params.commentId),
        columns: { id: true, authorId: true, deletedAt: true },
      });

      if (!row) {
        set.status = 404;
        return { error: "Комментарий не найден" };
      }

      if (row.authorId !== body.userId) {
        set.status = 403;
        return { error: "Редактировать можно только свой комментарий" };
      }

      if (row.deletedAt) {
        set.status = 400;
        return { error: "Нельзя редактировать удалённый комментарий" };
      }

      let cleanContent = contentRaw;
      let matchedCount = 0;
      let censored = false;
      try {
        const m = await applyModerationOrThrow({
          userId: body.userId,
          targetType: "comment",
          targetId: row.id,
          scope: "comments",
          text: contentRaw,
        });
        cleanContent = m.cleanText;
        censored = m.result.censored;
        matchedCount = m.result.matchedCount;
      } catch (e) {
        set.status = 400;
        return { error: e instanceof Error ? e.message : "Комментарий не прошёл модерацию" };
      }

      await db
        .update(comments)
        .set({
          content: cleanContent.slice(0, 8000),
          editedAt: new Date(),
          editedByStaffId: null,
        })
        .where(and(eq(comments.id, row.id), eq(comments.authorId, body.userId)));

      if (censored && row?.id) {
        await logModerationEvent({
          userId: body.userId,
          targetType: "comment",
          targetId: row.id,
          action: "censor",
          scope: "comments",
          matchedCount,
        });
      }

      return { ok: true };
    },
    {
      body: t.Object({
        userId: t.String(),
        content: t.String(),
      }),
    }
  )

  .delete(
    "/comments/:commentId",
    async ({ params, body, set }) => {
      const row = await db.query.comments.findFirst({
        where: eq(comments.id, params.commentId),
        columns: { id: true, authorId: true, deletedAt: true },
      });

      if (!row) {
        set.status = 404;
        return { error: "Комментарий не найден" };
      }

      if (row.authorId !== body.userId) {
        set.status = 403;
        return { error: "Можно удалить только свой комментарий" };
      }

      if (row.deletedAt) {
        return { ok: true };
      }

      await db
        .update(comments)
        .set({
          deletedAt: new Date(),
          deletedById: body.userId,
          content: "",
        })
        .where(and(eq(comments.id, row.id), eq(comments.authorId, body.userId)));

      return { ok: true };
    },
    {
      body: t.Object({
        userId: t.String(),
      }),
    }
  );
