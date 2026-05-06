import { Elysia, t } from "elysia";
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "../db";
import { contentReports, friendships, postLikes, postTags, posts } from "../db/schema";
import { slugify } from "../../lib/slug";
import { applyModerationOrThrow, logModerationEvent } from "../moderation";
import { parseUuidList } from "@/lib/parse-query-ids";

async function makeUniqueSlug(title: string) {
  const base = slugify(title) || "post";
  let slug = base;
  let i = 1;

  while (true) {
    const existing = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
      columns: { id: true },
    });

    if (!existing) {
      return slug;
    }

    slug = `${base}-${i++}`;
  }
}

export const postsRouter = new Elysia({ prefix: "/posts" })
  .get(
    "/",
    async ({ query }) => {
      const categoryIds = parseUuidList(query.categoryIds ?? null, 10);
      const tagIds = parseUuidList(query.tagIds ?? null, 80);

      const sortRaw = String(query.sort ?? "popular").toLowerCase();
      const sortAllowed = new Set([
        "popular",
        "new",
        "old",
        "views",
        "likes",
        "dislikes",
      ]);
      const sort = sortAllowed.has(sortRaw) ? sortRaw : "popular";

      const revisionRaw = String(query.revision ?? "all").toLowerCase();
      const revision = revisionRaw === "cleared" ? "cleared" : "all";

      let friendIds = new Set<string>();
      if (query.viewerId) {
        const rows = await db.query.friendships.findMany({
          where: and(
            eq(friendships.status, "accepted"),
            or(
              eq(friendships.requesterId, query.viewerId),
              eq(friendships.addresseeId, query.viewerId)
            )
          ),
          columns: { requesterId: true, addresseeId: true },
        });
        friendIds = new Set(
          rows.map((row) =>
            row.requesterId === query.viewerId ? row.addresseeId : row.requesterId
          )
        );
      }

      let postIdFilter: string[] | null = null;
      if (tagIds.length > 0) {
        const tagged = await db
          .selectDistinct({ postId: postTags.postId })
          .from(postTags)
          .where(inArray(postTags.tagId, tagIds));
        postIdFilter = tagged.map((t) => t.postId);
        if (postIdFilter.length === 0) return { posts: [] };
      }

      const whereParts: SQL[] = [eq(posts.isPublished, true)];
      if (categoryIds.length > 0) whereParts.push(inArray(posts.categoryId, categoryIds));
      if (postIdFilter) whereParts.push(inArray(posts.id, postIdFilter));
      if (revision === "cleared") whereParts.push(isNull(posts.staffRevisionRequestedAt));

      const likeCnt = sql<number>`(
        select count(*)::int from post_likes pl
        where pl.post_id = ${posts.id} and pl.type = 'like'
      )`;
      const dislikeCnt = sql<number>`(
        select count(*)::int from post_likes pl
        where pl.post_id = ${posts.id} and pl.type = 'dislike'
      )`;
      const popularityScore = sql`(
        coalesce(${posts.views}, 0)
        + coalesce(${likeCnt}, 0) * 8
        - coalesce(${dislikeCnt}, 0) * 4
      )`;

      const baseWhere = and(...whereParts);
      const orderByClause =
        sort === "new"
          ? [desc(posts.createdAt), desc(posts.id)]
          : sort === "old"
            ? [asc(posts.createdAt), asc(posts.id)]
            : sort === "views"
              ? [desc(posts.views), desc(posts.createdAt)]
              : sort === "likes"
                ? [desc(likeCnt), desc(posts.createdAt)]
                : sort === "dislikes"
                  ? [desc(dislikeCnt), desc(posts.createdAt)]
                  : [desc(popularityScore), desc(posts.createdAt)];

      const orderedRows = await db
        .select({ id: posts.id })
        .from(posts)
        .where(baseWhere)
        .orderBy(...orderByClause);

      const ids = orderedRows.map((r) => r.id);
      if (ids.length === 0) return { posts: [] };

      const full = await db.query.posts.findMany({
        where: inArray(posts.id, ids),
        with: { author: true, category: true, postTags: { with: { tag: true } } },
      });

      const countsRows = await db
        .select({ postId: postLikes.postId, type: postLikes.type, n: count() })
        .from(postLikes)
        .where(inArray(postLikes.postId, ids))
        .groupBy(postLikes.postId, postLikes.type);

      const reactionMap = new Map<string, { likes: number; dislikes: number }>();
      for (const row of countsRows) {
        const cur = reactionMap.get(row.postId) ?? { likes: 0, dislikes: 0 };
        const add = Number(row.n) || 0;
        if (row.type === "like") cur.likes = add;
        else if (row.type === "dislike") cur.dislikes = add;
        reactionMap.set(row.postId, cur);
      }

      const byId = new Map(full.map((p) => [p.id, p]));
      const list = ids.map((id) => byId.get(id)).filter(Boolean) as typeof full;

      return {
        posts: list.map((p) => {
          const rc = reactionMap.get(p.id) ?? { likes: 0, dislikes: 0 };
          return {
            id: p.id,
            slug: p.slug,
            title: p.title,
            content: p.content,
            coverImage: p.coverImage ?? null,
            createdAt: p.createdAt?.toISOString?.() ?? p.createdAt,
            views: Number(p.views ?? 0),
            likeCount: rc.likes,
            dislikeCount: rc.dislikes,
            author: p.author
              ? {
                  id: p.author.id,
                  username: p.author.username,
                  avatarUrl: p.author.avatarUrl ?? null,
                  isFriend: friendIds.has(p.author.id),
                }
              : null,
            category: p.category ? { id: p.category.id, title: p.category.title } : null,
            tags: p.postTags.map((x) => ({ id: x.tag.id, name: x.tag.name })),
          };
        }),
      };
    },
    {
      query: t.Object({
        sort: t.Optional(t.String()),
        categoryIds: t.Optional(t.String()),
        tagIds: t.Optional(t.String()),
        revision: t.Optional(t.String()),
        viewerId: t.Optional(t.String()),
      }),
    }
  )

  .get(
    "/:slug",
    async ({ params, query, request, set }) => {
      const post = await db.query.posts.findFirst({
        where: and(eq(posts.slug, params.slug), eq(posts.isPublished, true)),
        with: {
          author: true,
          category: true,
          postTags: {
            with: {
              tag: true,
            },
          },
        },
      });

      if (!post) {
        set.status = 404;
        return { error: "Post not found" };
      }

      const purpose = `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`.toLowerCase();
      const shouldCount = !purpose.includes("prefetch");
      if (shouldCount) {
        try {
          await db
            .update(posts)
            .set({ views: sql`coalesce(${posts.views}, 0) + 1` })
            .where(eq(posts.id, post.id));
          post.views = Number(post.views ?? 0) + 1;
        } catch (e) {
          console.error("GET /api/posts/:slug view increment warning:", e);
        }
      }

      const counts = await db
        .select({
          type: postLikes.type,
          count: sql<number>`count(*)`.as("count"),
        })
        .from(postLikes)
        .where(eq(postLikes.postId, post.id))
        .groupBy(postLikes.type);

      let likeCount = 0;
      let dislikeCount = 0;

      for (const row of counts) {
        const value = Number(row.count) || 0;

        if (row.type === "like") likeCount = value;
        if (row.type === "dislike") dislikeCount = value;
      }

      let likedByMe = false;
      let dislikedByMe = false;

      if (query.viewerId) {
        const myReaction = await db.query.postLikes.findFirst({
          where: and(
            eq(postLikes.postId, post.id),
            eq(postLikes.userId, query.viewerId)
          ),
          columns: { type: true },
        });

        likedByMe = myReaction?.type === "like";
        dislikedByMe = myReaction?.type === "dislike";
      }

      return {
        post: {
          id: post.id,
          slug: post.slug,
          title: post.title,
          content: post.content,
          createdAt: post.createdAt?.toISOString?.() ?? null,
          coverImage: post.coverImage ?? null,
          views: Number(post.views ?? 0),
          author: post.author
            ? {
                id: post.author.id,
                username: post.author.username,
                avatarUrl: post.author.avatarUrl ?? null,
              }
            : null,
          category: post.category
            ? {
                id: post.category.id,
                title: post.category.title,
              }
            : null,
          tags: post.postTags.map((item) => ({
            id: item.tag.id,
            name: item.tag.name,
          })),
          likeCount,
          dislikeCount,
          likedByMe,
          dislikedByMe,
        },
      };
    },
    {
      query: t.Object({
        viewerId: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/",
    async ({ body, set }) => {
      const title = body.title.trim();
      const content = body.content.trim();
      const categoryId = body.categoryId ?? null;
      const tagIds = Array.from(new Set(body.tagIds ?? []));
      const isPublished = body.isPublished === false ? false : true;
      const coverImage = body.coverImage ?? null;

      if (!title || !content) {
        set.status = 400;
        return { error: "Заполните title и content" };
      }

      const author = await db.query.users.findFirst({
        where: eq(require("../db/schema").users.id, body.userId),
        columns: { id: true },
      });

      if (!author) {
        set.status = 401;
        return { error: "User not found" };
      }

      let titleClean = title;
      let contentClean = content;
      let matchedCount = 0;
      let wasCensored = false;

      try {
        const mt = await applyModerationOrThrow({
          userId: body.userId,
          targetType: "post",
          targetId: null,
          scope: "posts",
          text: title,
        });
        if (mt.result.censored) {
          wasCensored = true;
          matchedCount += mt.result.matchedCount;
          titleClean = mt.cleanText;
        }

        const mc = await applyModerationOrThrow({
          userId: body.userId,
          targetType: "post",
          targetId: null,
          scope: "posts",
          text: content,
        });
        if (mc.result.censored) {
          wasCensored = true;
          matchedCount += mc.result.matchedCount;
          contentClean = mc.cleanText;
        }
      } catch (e) {
        set.status = 400;
        return { error: e instanceof Error ? e.message : "Текст не прошёл модерацию" };
      }

      const slug = await makeUniqueSlug(title);

      const inserted = await db
        .insert(posts)
        .values({
          title: titleClean,
          slug,
          content: contentClean,
          authorId: body.userId,
          categoryId,
          isPublished,
          coverImage,
        })
        .returning({
          id: posts.id,
          slug: posts.slug,
        });

      const post = inserted[0];

      if (wasCensored && post?.id) {
        await logModerationEvent({
          userId: body.userId,
          targetType: "post",
          targetId: post.id,
          action: "censor",
          scope: "posts",
          matchedCount,
        });
      }

      if (tagIds.length > 0) {
        await db.insert(postTags).values(
          tagIds.map((tagId) => ({
            postId: post.id,
            tagId,
          }))
        );
      }

      return {
        success: true,
        post: {
          id: post.id,
          slug: post.slug,
        },
      };
    },
    {
      body: t.Object({
        userId: t.String(),
        title: t.String(),
        content: t.String(),
        categoryId: t.Optional(t.Nullable(t.String())),
        tagIds: t.Optional(t.Array(t.String())),
        isPublished: t.Optional(t.Boolean()),
        coverImage: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  .post(
    "/:slug/reaction",
    async ({ params, body, set }) => {
      const post = await db.query.posts.findFirst({
        where: eq(posts.slug, params.slug),
        columns: { id: true },
      });

      if (!post) {
        set.status = 404;
        return { error: "Post not found" };
      }

      const existing = await db.query.postLikes.findFirst({
        where: and(
          eq(postLikes.postId, post.id),
          eq(postLikes.userId, body.userId)
        ),
        columns: { id: true, type: true },
      });

      if (existing) {
        if (existing.type === body.type) {
          await db.delete(postLikes).where(eq(postLikes.id, existing.id));
        } else {
          await db
            .update(postLikes)
            .set({ type: body.type })
            .where(eq(postLikes.id, existing.id));
        }
      } else {
        await db.insert(postLikes).values({
          postId: post.id,
          userId: body.userId,
          type: body.type,
        });
      }

      const counts = await db
        .select({
          type: postLikes.type,
          count: sql<number>`count(*)`.as("count"),
        })
        .from(postLikes)
        .where(eq(postLikes.postId, post.id))
        .groupBy(postLikes.type);

      let likeCount = 0;
      let dislikeCount = 0;

      for (const row of counts) {
        const value = Number(row.count) || 0;

        if (row.type === "like") likeCount = value;
        if (row.type === "dislike") dislikeCount = value;
      }

      const myReaction = await db.query.postLikes.findFirst({
        where: and(
          eq(postLikes.postId, post.id),
          eq(postLikes.userId, body.userId)
        ),
        columns: { type: true },
      });

      return {
        likeCount,
        dislikeCount,
        likedByMe: myReaction?.type === "like",
        dislikedByMe: myReaction?.type === "dislike",
      };
    },
    {
      body: t.Object({
        userId: t.String(),
        type: t.Union([t.Literal("like"), t.Literal("dislike")]),
      }),
    }
  )

  .post(
    "/:slug/report",
    async ({ params, body, set }) => {
      const post = await db.query.posts.findFirst({
        where: eq(posts.slug, params.slug),
        columns: { id: true },
      });
      if (!post) {
        set.status = 404;
        return { error: "Post not found" };
      }
      await db.insert(contentReports).values({
        reporterId: body.userId,
        targetType: "post",
        targetId: post.id,
        reason: body.reason?.trim() || null,
      });
      return { success: true };
    },
    {
      body: t.Object({
        userId: t.String(),
        reason: t.Optional(t.String()),
      }),
    }
  )

  .patch(
    "/:slug",
    async ({ params, body, set }) => {
      const post = await db.query.posts.findFirst({
        where: eq(posts.slug, params.slug),
        columns: { id: true, authorId: true, slug: true },
      });
      if (!post) {
        set.status = 404;
        return { error: "Post not found" };
      }
      if (post.authorId !== body.userId) {
        set.status = 403;
        return { error: "Можно редактировать только свой пост" };
      }
      const patch: Record<string, unknown> = {
        updatedAt: new Date(),
        staffRevisionRequestedAt: null,
        staffRevisionNote: null,
      };
      if (body.title != null) {
        const title = String(body.title).trim();
        if (title.length < 1) {
          set.status = 400;
          return { error: "Пустой заголовок" };
        }
        try {
          const mt = await applyModerationOrThrow({
            userId: body.userId,
            targetType: "post",
            targetId: post.id,
            scope: "posts",
            text: title.slice(0, 200),
          });
          patch.title = mt.cleanText;
        } catch (e) {
          set.status = 400;
          return { error: e instanceof Error ? e.message : "Заголовок не прошёл модерацию" };
        }
      }
      if (body.content != null) {
        const raw = String(body.content).trim();
        try {
          const mc = await applyModerationOrThrow({
            userId: body.userId,
            targetType: "post",
            targetId: post.id,
            scope: "posts",
            text: raw,
          });
          patch.content = mc.cleanText;
        } catch (e) {
          set.status = 400;
          return { error: e instanceof Error ? e.message : "Текст не прошёл модерацию" };
        }
      }
      if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
      if (body.coverImage !== undefined) patch.coverImage = body.coverImage;

      const updated = await db
        .update(posts)
        .set(patch)
        .where(eq(posts.id, post.id))
        .returning({ id: posts.id, slug: posts.slug, title: posts.title });

      const row = updated[0];

      await db
        .update(posts)
        .set({
          staffRevisionRequestedAt: null,
          staffRevisionNote: null,
        })
        .where(eq(posts.id, post.id));

      if (body.tagIds && Array.isArray(body.tagIds)) {
        await db.delete(postTags).where(eq(postTags.postId, post.id));
        if (body.tagIds.length) {
          await db.insert(postTags).values(
            body.tagIds.map((tagId: string) => ({ postId: post.id, tagId }))
          );
        }
      }
      if (!row) {
        set.status = 500;
        return { error: "Update failed" };
      }
      return { success: true, post: row };
    },
    {
      body: t.Object({
        userId: t.String(),
        title: t.Optional(t.String()),
        content: t.Optional(t.String()),
        categoryId: t.Optional(t.Nullable(t.String())),
        tagIds: t.Optional(t.Array(t.String())),
        coverImage: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  .delete(
    "/:slug",
    async ({ params, query, set }) => {
      const userId = String((query as { userId?: string }).userId ?? "");
      if (!userId) {
        set.status = 400;
        return { error: "userId обязателен" };
      }
      const post = await db.query.posts.findFirst({
        where: eq(posts.slug, params.slug),
        columns: { id: true, authorId: true },
      });
      if (!post) {
        set.status = 404;
        return { error: "Post not found" };
      }
      if (post.authorId !== userId) {
        set.status = 403;
        return { error: "Можно удалить только свой пост" };
      }
      await db.delete(posts).where(eq(posts.id, post.id));
      return { success: true };
    },
    { query: t.Object({ userId: t.String() }) }
  );
