import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { userWarnings } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = await resolveUserUuid(session);
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const updated = await db
      .update(userWarnings)
      .set({ dismissedAt: new Date() })
      .where(and(eq(userWarnings.id, id), eq(userWarnings.userId, userId)))
      .returning({ id: userWarnings.id });

    if (!updated.length) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST dismiss warning", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
