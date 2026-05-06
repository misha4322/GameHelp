import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, sql } from "drizzle-orm";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { postLikes, postTags, posts, users } from "@/server/db/schema";
import { checkUserPostingBan } from "@/lib/user-ban";
import { resolveUserUuid } from "@/lib/user-utils";
import { applyModerationOrThrow } from "@/server/moderation";

export const runtime = "nodejs";

function shouldCountView(req: Request) {
  const purpose = `${req.headers.get("purpose") ?? ""} ${req.headers.get("sec-purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch")) return false;
  return true;
}

function parseSeenPostIds(cookieValue: string | undefined | null): string[] {
  if (!cookieValue) return [];
  return cookieValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
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
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const cookieHeader = req.headers.get("cookie") ?? "";
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)gh_pv=([^;]+)/);
    const seenIds = parseSeenPostIds(cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);
    const alreadySeen = seenIds.includes(post.id);
    const countThisView = shouldCountView(req) && !alreadySeen;

    if (countThisView) {
      try {
        await db
          .update(posts)
          .set({ views: sql`coalesce(${posts.views}, 0) + 1` })
          .where(eq(posts.id, post.id));
        post.views = Number(post.views ?? 0) + 1;
      } catch (viewErr) {
        console.error("GET /api/posts/[slug] view increment warning:", viewErr);
      }
    }

    let userId: string | null = null;

    try {
      const session = await getServerSession(authOptions);
      userId = session ? await resolveUserUuid(session) : null;
    } catch (sessionError) {
      console.error("GET /api/posts/[slug] session warning:", sessionError);
      userId = null;
    }

    const likes = await db
      .select({
        type: postLikes.type,
        count: sql`count(*)`.as("count"),
      })
      .from(postLikes)
      .where(eq(postLikes.postId, post.id))
      .groupBy(postLikes.type);

    let likeCount = 0;
    let dislikeCount = 0;

    for (const row of likes) {
      const n = Number(row.count) || 0;

      if (row.type === "like") likeCount = n;
      if (row.type === "dislike") dislikeCount = n;
    }

    let likedByMe = false;
    let dislikedByMe = false;

    if (userId) {
      try {
        const my = await db.query.postLikes.findFirst({
          where: and(eq(postLikes.postId, post.id), eq(postLikes.userId, userId)),
          columns: { type: true },
        });

        likedByMe = my?.type === "like";
        dislikedByMe = my?.type === "dislike";
      } catch (reactionError) {
        console.error("GET /api/posts/[slug] reaction warning:", reactionError);
      }
    }

    const res = NextResponse.json({
      post: {
        id: post.id,
        slug: post.slug,
        title: post.title,
        content: post.content,
        createdAt: post.createdAt?.toISOString() ?? null,
        coverImage: post.coverImage ?? null,
        views: Number(post.views ?? 0),
        author: post.author
          ? {
              id: post.author.id,
              username: post.author.username,
              avatarUrl: post.author.avatarUrl ?? null,
            }
          : {
              id: "",
              username: "Пользователь",
              avatarUrl: null,
            },
        category: post.category
          ? {
              id: post.category.id,
              title: post.category.title,
            }
          : null,
        tags: Array.isArray(post.postTags)
          ? post.postTags.map((x) => ({
              id: x.tag.id,
              name: x.tag.name,
            }))
          : [],
        likeCount,
        dislikeCount,
        likedByMe,
        dislikedByMe,
      },
    });

    if (countThisView) {
      const nextIds = [...seenIds.filter((id) => id !== post.id), post.id].slice(-50);
      res.cookies.set("gh_pv", nextIds.join(","), {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
      });
    }

    return res;
  } catch (e) {
    console.error("GET /api/posts/[slug] error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const session = await getServerSession(authOptions);
    const viewerId = session?.user ? await resolveUserUuid(session) : null;
    if (!viewerId) {
      return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      userId?: string;
      title?: string;
      content?: string;
      categoryId?: string | null;
      tagIds?: string[];
      coverImage?: string | null;
    };

    const claimedUserId = body.userId?.trim();
    if (claimedUserId && claimedUserId !== viewerId) {
      return NextResponse.json({ error: "Несовпадение учётной записи" }, { status: 403 });
    }

    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
      columns: { id: true, authorId: true, slug: true },
    });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (post.authorId !== viewerId) {
      return NextResponse.json({ error: "Можно редактировать только свой пост" }, { status: 403 });
    }

    const authorBan = await db.query.users.findFirst({
      where: eq(users.id, viewerId),
      columns: { bannedUntil: true, isBanned: true },
    });
    const ban = checkUserPostingBan(authorBan);
    if (!ban.ok) {
      return NextResponse.json({ error: ban.error }, { status: 403 });
    }

    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      staffRevisionRequestedAt: null,
      staffRevisionNote: null,
    };
    if (body.title != null) {
      const title = String(body.title).trim();
      if (title.length < 1) {
        return NextResponse.json({ error: "Пустой заголовок" }, { status: 400 });
      }
      try {
        const mt = await applyModerationOrThrow({
          userId: viewerId,
          targetType: "post",
          targetId: post.id,
          scope: "posts",
          text: title.slice(0, 200),
        });
        patch.title = mt.cleanText;
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Заголовок не прошёл модерацию" },
          { status: 400 }
        );
      }
    }
    if (body.content != null) {
      const raw = String(body.content).trim();
      try {
        const mc = await applyModerationOrThrow({
          userId: viewerId,
          targetType: "post",
          targetId: post.id,
          scope: "posts",
          text: raw,
        });
        patch.content = mc.cleanText;
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Текст не прошёл модерацию" },
          { status: 400 }
        );
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

    /* Отдельный UPDATE только на NULL ревизии — страховка, если Drizzle/pg проигнорировали null в смешанном set */
    await db
      .update(posts)
      .set({
        staffRevisionRequestedAt: null,
        staffRevisionNote: null,
      })
      .where(eq(posts.id, post.id));

    if (body.tagIds && Array.isArray(body.tagIds)) {
      const tagIds = Array.from(new Set(body.tagIds));
      await db.delete(postTags).where(eq(postTags.postId, post.id));
      if (tagIds.length) {
        await db.insert(postTags).values(
          tagIds.map((tagId) => ({ postId: post.id, tagId }))
        );
      }
    }
    if (!row) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
    return NextResponse.json({ success: true, post: row });
  } catch (e) {
    console.error("PATCH /api/posts/[slug] error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const url = new URL(_req.url);
    const userId = String(url.searchParams.get("userId") ?? "");
    if (!userId) {
      return NextResponse.json({ error: "userId обязателен" }, { status: 400 });
    }

    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
      columns: { id: true, authorId: true },
    });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (post.authorId !== userId) {
      return NextResponse.json({ error: "Можно удалить только свой пост" }, { status: 403 });
    }
    await db.delete(posts).where(eq(posts.id, post.id));
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/posts/[slug] error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}