import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { posts, postLikes } from "@/server/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = await resolveUserUuid(session);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const type = body?.type === "dislike" ? "dislike" : "like";

    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
      columns: { id: true },
    });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const existing = await db.query.postLikes.findFirst({
      where: and(eq(postLikes.postId, post.id), eq(postLikes.userId, userId)),
      columns: { id: true, type: true },
    });

    let action: "added" | "updated" | "removed";

    if (existing) {
      if (existing.type === type) {
        await db.delete(postLikes).where(eq(postLikes.id, existing.id));
        action = "removed";
      } else {
        await db
          .update(postLikes)
          .set({ type })
          .where(eq(postLikes.id, existing.id));
        action = "updated";
      }
    } else {
      await db.insert(postLikes).values({ postId: post.id, userId, type });
      action = "added";
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
      const n = Number(row.count) || 0;
      if (row.type === "like") likeCount = n;
      if (row.type === "dislike") dislikeCount = n;
    }

    const my = await db.query.postLikes.findFirst({
      where: and(eq(postLikes.postId, post.id), eq(postLikes.userId, userId)),
      columns: { type: true },
    });

    return NextResponse.json({
      action,
      likeCount,
      dislikeCount,
      likedByMe: my?.type === "like",
      dislikedByMe: my?.type === "dislike",
    });
  } catch (e) {
    console.error("POST /api/posts/[slug]/reaction error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}