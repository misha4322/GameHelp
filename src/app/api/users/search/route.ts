import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, eq, ilike, or } from "drizzle-orm";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { friendships, users } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isFriendCode(value: string) {
  return /^\d{4}-\d{4}$/i.test(value.trim());
}

async function getFriendStatus(viewerId: string | null, targetId: string) {
  if (!viewerId) return "none" as const;
  if (viewerId === targetId) return "self" as const;

  const direct = await db.query.friendships.findFirst({
    where: and(eq(friendships.requesterId, viewerId), eq(friendships.addresseeId, targetId)),
    columns: { status: true },
  });
  const reverse = await db.query.friendships.findFirst({
    where: and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, viewerId)),
    columns: { status: true },
  });

  if (direct?.status === "accepted" || reverse?.status === "accepted") return "friends" as const;
  if (direct?.status === "pending") return "outgoing" as const;
  if (reverse?.status === "pending") return "incoming" as const;
  return "none" as const;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (!q) return NextResponse.json({ users: [] });

  const session = await getServerSession(authOptions);
  const viewerId = session?.user ? await resolveUserUuid(session) : null;

  const conditions = [ilike(users.username, `%${q}%`)];
  if (isUuid(q)) conditions.push(eq(users.id, q));
  if (isFriendCode(q.toUpperCase())) conditions.push(eq(users.friendCode, q.toUpperCase()));

  const list = await db.query.users.findMany({
    where: conditions.length === 1 ? conditions[0] : or(...conditions),
    columns: {
      id: true,
      username: true,
      avatarUrl: true,
      friendCode: true,
      isProfilePrivate: true,
      createdAt: true,
    },
    limit: 20,
  });

  const result = await Promise.all(
    list.map(async (user) => {
      const friendStatus = await getFriendStatus(viewerId, user.id);
      const canView = !user.isProfilePrivate || friendStatus === "self";

      return {
        id: user.id,
        username: user.username,
        avatarUrl: canView ? user.avatarUrl ?? null : null,
        friendCode: friendStatus === "self" ? user.friendCode ?? null : null,
        isProfilePrivate: user.isProfilePrivate,
        createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
        friendStatus,
        canView,
      };
    })
  );

  return NextResponse.json({ users: result });
}

