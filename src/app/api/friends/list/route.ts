import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { friendships, users } from "@/server/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await resolveUserUuid(session);
  if (!userId) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const rows = await db.query.friendships.findMany({
    where: and(
      eq(friendships.status, "accepted"),
      or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
    ),
    columns: { requesterId: true, addresseeId: true },
  });

  const friendIds = rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  if (!friendIds.length) return NextResponse.json({ friends: [] });

  const list = await db.query.users.findMany({
    where: inArray(users.id, friendIds),
    columns: { id: true, username: true, avatarUrl: true, friendCode: true },
  });

  return NextResponse.json({ friends: list });
}