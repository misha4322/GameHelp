import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { parseUuidList } from "@/lib/parse-query-ids";
import { db } from "@/server/db";
import { friendships, postLikes, posts, postTags, users } from "@/server/db/schema";
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { slugify } from "@/lib/slug";
import { checkUserPostingBan } from "@/lib/user-ban";
import { resolveUserUuid } from "@/lib/user-utils";
import { applyModerationOrThrow, logModerationEvent } from "@/server/moderation";

export const runtime = "nodejs";

async function makeUniqueSlug(title: string) {
  const base = slugify(title) || "post";
  let slug = base;
  let i = 1;
  while (true) {
    const exists = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
    });
    if (!exists) return slug;
    slug = `${base}-${i++}`;
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const viewerId = session?.user ? await resolveUserUuid(session) : null;

    const { searchParams } = new URL(req.url);
    const categoryIds = parseUuidList(searchParams.get("categoryIds"), 10);
    const tagIds = parseUuidList(searchParams.get("tagIds"), 80);

    const sortRaw = String(searchParams.get("sort") ?? "popular").toLowerCase();
    const sortAllowed = new Set([
      "popular",
      "new",
      "old",
      "views",
      "likes",
      "dislikes",
    ]);
    const sort = sortAllowed.has(sortRaw) ? sortRaw : "popular";

    const revisionRaw = String(searchParams.get("revision") ?? "all").toLowerCase();
    const revision = revisionRaw === "cleared" ? "cleared" : "all";

    let friendIds = new Set<string>();
    if (viewerId) {
      const rows = await db.query.friendships.findMany({
        where: and(
          eq(friendships.status, "accepted"),
          or(
            eq(friendships.requesterId, viewerId),
            eq(friendships.addresseeId, viewerId)
          )
        ),
        columns: {
          requesterId: true,
          addresseeId: true,
        },
      });

      friendIds = new Set(
        rows.map((row) =>
          row.requesterId === viewerId ? row.addresseeId : row.requesterId
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
      if (postIdFilter.length === 0) {
        return NextResponse.json({ posts: [] });
      }
    }

    const whereParts: SQL[] = [eq(posts.isPublished, true)];
    if (categoryIds.length > 0) {
      whereParts.push(inArray(posts.categoryId, categoryIds));
    }
    if (postIdFilter) {
      whereParts.push(inArray(posts.id, postIdFilter));
    }
    if (revision === "cleared") {
      whereParts.push(isNull(posts.staffRevisionRequestedAt));
    }

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
    if (ids.length === 0) {
      return NextResponse.json({ posts: [] });
    }

    const full = await db.query.posts.findMany({
      where: inArray(posts.id, ids),
      with: {
        author: true,
        category: true,
        postTags: { with: { tag: true } },
      },
    });

    const countsRows = await db
      .select({
        postId: postLikes.postId,
        type: postLikes.type,
        n: count(),
      })
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

    return NextResponse.json({
      posts: list.map((p) => {
        const rc = reactionMap.get(p.id) ?? { likes: 0, dislikes: 0 };
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          content: p.content,
          coverImage: p.coverImage ?? null,
          createdAt: p.createdAt?.toISOString?.() ?? p.createdAt,
          views: p.views ?? 0,
          likeCount: rc.likes,
          dislikeCount: rc.dislikes,
          author: {
            id: p.author.id,
            username: p.author.username,
            avatarUrl: p.author.avatarUrl ?? null,
            isFriend: friendIds.has(p.author.id),
          },
          category: p.category
            ? { id: p.category.id, title: p.category.title }
            : null,
          tags: p.postTags.map((x) => ({ id: x.tag.id, name: x.tag.name })),
        };
      }),
    });
  } catch (e) {
    console.error("GET /api/posts error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
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

    const body = await req.json();
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "").trim();
    const categoryId = body.categoryId ? String(body.categoryId) : null;
    const tagIds: string[] = Array.isArray(body.tagIds)
      ? body.tagIds.map(String)
      : [];
    const isPublished = body.isPublished === false ? false : true;
    const coverImage = body.coverImage ? String(body.coverImage) : null; // ✅ добавлено

    if (!title || !content) {
      return NextResponse.json(
        { error: "Заполните title и content" },
        { status: 400 }
      );
    }

    let titleClean = title;
    let contentClean = content;
    let matchedCount = 0;
    let wasCensored = false;

    try {
      const mt = await applyModerationOrThrow({
        userId,
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
        userId,
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
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Текст не прошёл модерацию" },
        { status: 400 }
      );
    }

    const slug = await makeUniqueSlug(title);

    const inserted = await db
      .insert(posts)
      .values({
        title: titleClean,
        slug,
        content: contentClean,
        authorId: userId,
        categoryId,
        isPublished,
        coverImage, // ✅ добавлено
      })
      .returning();

    const post = inserted[0];

    if (wasCensored && post?.id) {
      await logModerationEvent({
        userId,
        targetType: "post",
        targetId: post.id,
        action: "censor",
        scope: "posts",
        matchedCount,
      });
    }

    if (tagIds.length) {
      await db.insert(postTags).values(
        tagIds.map((tagId) => ({
          postId: post.id,
          tagId,
        }))
      );
    }

    return NextResponse.json({ success: true, post: { id: post.id, slug: post.slug } });
  } catch (e) {
    console.error("POST /api/posts error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}