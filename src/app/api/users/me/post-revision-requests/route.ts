import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { posts } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ items: [] }, { status: 401 });
  }

  const userId = await resolveUserUuid(session);
  if (!userId) {
    return NextResponse.json({ items: [] }, { status: 401 });
  }

  try {
    const rows = await db
      .select({
        slug: posts.slug,
        title: posts.title,
        note: posts.staffRevisionNote,
        requestedAt: posts.staffRevisionRequestedAt,
      })
      .from(posts)
      .where(and(eq(posts.authorId, userId), isNotNull(posts.staffRevisionRequestedAt)))
      .orderBy(desc(posts.staffRevisionRequestedAt));

    return NextResponse.json(
      {
        items: rows.map((r) => ({
          slug: r.slug,
          title: r.title,
          note: r.note ?? null,
          requestedAt: r.requestedAt?.toISOString?.() ?? null,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    console.error("GET /api/users/me/post-revision-requests", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
