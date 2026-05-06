import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { friendships } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await resolveUserUuid(session);
  if (!userId) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requesterId = typeof body.requesterId === "string" ? body.requesterId : null;
  if (!requesterId) return NextResponse.json({ error: "requesterId обязателен" }, { status: 400 });

  const reqRow = await db.query.friendships.findFirst({
    where: and(
      eq(friendships.requesterId, requesterId),
      eq(friendships.addresseeId, userId),
      eq(friendships.status, "pending")
    ),
    columns: { id: true },
  });

  if (!reqRow) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });

  await db.update(friendships).set({ status: "accepted", updatedAt: new Date() }).where(eq(friendships.id, reqRow.id));
  return NextResponse.json({ success: true, status: "accepted" });
}