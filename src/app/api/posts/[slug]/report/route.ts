import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { clampModerationText } from "@/lib/moderation-text-limit";
import { resolveUserUuid } from "@/lib/user-utils";
import { db } from "@/server/db";
import { contentReports, posts } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  const reporterId = session ? await resolveUserUuid(session) : null;
  if (!reporterId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    reason?: string;
  };
  if (body.userId && body.userId !== reporterId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const post = await db.query.posts.findFirst({
    where: eq(posts.slug, slug),
    columns: { id: true },
  });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const reasonRaw = body.reason?.trim();
  const reason = reasonRaw ? clampModerationText(reasonRaw) : null;

  await db.insert(contentReports).values({
    reporterId,
    targetType: "post",
    targetId: post.id,
    reason,
  });

  return NextResponse.json({ success: true });
}
