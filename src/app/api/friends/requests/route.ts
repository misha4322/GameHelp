import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, inArray } from "drizzle-orm";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { friendships, users } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await resolveUserUuid(session);
  if (!userId) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const rows = await db
    .select({
      requesterId: friendships.requesterId,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .where(and(eq(friendships.addresseeId, userId), eq(friendships.status, "pending")));

  const requesterIds = rows.map((row) => row.requesterId);
  if (!requesterIds.length) return NextResponse.json({ requests: [] });

  const requestUsers = await db.query.users.findMany({
    where: inArray(users.id, requesterIds),
    columns: { id: true, username: true, avatarUrl: true },
  });

  return NextResponse.json({
    requests: rows
      .map((row) => ({
        from: requestUsers.find((user) => user.id === row.requesterId) ?? null,
        createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
      }))
      .filter((row) => row.from !== null),
  });
}

