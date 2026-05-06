import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { friendships } from "@/server/db/schema";
import { and, eq, or } from "drizzle-orm";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await resolveUserUuid(session);
  if (!userId) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const targetId = typeof body.targetId === "string" ? body.targetId : null;
  if (!targetId) return NextResponse.json({ error: "targetId обязателен" }, { status: 400 });

  await db.delete(friendships).where(
    or(
      and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, targetId)),
      and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, userId))
    )
  );

  return NextResponse.json({ success: true });
}