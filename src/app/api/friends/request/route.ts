import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { friendships, users } from "@/server/db/schema";
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
  if (targetId === userId) return NextResponse.json({ error: "Нельзя добавить себя" }, { status: 400 });

  const targetExists = await db.query.users.findFirst({
    where: eq(users.id, targetId),
    columns: { id: true },
  });
  if (!targetExists) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // если уже друзья
  const accepted = await db.query.friendships.findFirst({
    where: and(
      eq(friendships.status, "accepted"),
      or(
        and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, targetId)),
        and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, userId))
      )
    ),
    columns: { id: true },
  });
  if (accepted) return NextResponse.json({ success: true, status: "accepted" });

  // если есть входящая заявка (target -> me) — НЕ принимаем, просто говорим что она есть
  const incoming = await db.query.friendships.findFirst({
    where: and(
      eq(friendships.requesterId, targetId),
      eq(friendships.addresseeId, userId),
      eq(friendships.status, "pending")
    ),
    columns: { id: true },
  });
  if (incoming) {
    return NextResponse.json({
      success: true,
      status: "incoming",
      message: "У вас есть входящая заявка от этого пользователя. Нажмите «Принять».",
    });
  }

  // если уже отправлял
  const existing = await db.query.friendships.findFirst({
    where: and(
      eq(friendships.requesterId, userId),
      eq(friendships.addresseeId, targetId),
      eq(friendships.status, "pending")
    ),
    columns: { id: true },
  });
  if (existing) return NextResponse.json({ success: true, status: "pending" });

  await db.insert(friendships).values({
    requesterId: userId,
    addresseeId: targetId,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return NextResponse.json({ success: true, status: "pending" });
}