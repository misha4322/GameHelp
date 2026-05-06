import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { userWarnings } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = await resolveUserUuid(session);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const rows = await db
      .select({
        id: userWarnings.id,
        commentSnapshot: userWarnings.commentSnapshot,
        reason: userWarnings.reason,
        createdAt: userWarnings.createdAt,
      })
      .from(userWarnings)
      .where(and(eq(userWarnings.userId, userId), isNull(userWarnings.dismissedAt)))
      .orderBy(desc(userWarnings.createdAt));

    return NextResponse.json({
      warnings: rows.map((w) => ({
        id: w.id,
        commentSnapshot: w.commentSnapshot ?? null,
        reason: w.reason,
        createdAt: w.createdAt?.toISOString() ?? new Date().toISOString(),
      })),
    });
  } catch (e) {
    console.error("GET /api/users/me/warnings", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
