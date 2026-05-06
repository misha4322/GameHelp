import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { posts, postLikes } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
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
      return NextResponse.json(
        { error: "User not found (bad session id)" },
        { status: 401 }
      );
    }

    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
      columns: { id: true },
    });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const existing = await db.query.postLikes.findFirst({
      where: and(eq(postLikes.postId, post.id), eq(postLikes.userId, userId)),
    });

    if (existing) {
      await db.delete(postLikes).where(eq(postLikes.id, existing.id));
      return NextResponse.json({ liked: false });
    } else {
      await db.insert(postLikes).values({ postId: post.id, userId });
      return NextResponse.json({ liked: true });
    }
  } catch (e) {
    console.error("POST /api/posts/[slug]/like error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}