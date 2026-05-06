import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await resolveUserUuid(session);
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const me = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isBanned: true, bannedUntil: true },
  });

  const now = new Date();

  if (me?.isBanned && !me.bannedUntil) {
    return NextResponse.json({
      restricted: true,
      permanent: true,
      bannedUntil: null,
    });
  }

  if (me?.bannedUntil && me.bannedUntil > now) {
    return NextResponse.json({
      restricted: true,
      permanent: false,
      bannedUntil: me.bannedUntil.toISOString(),
    });
  }

  return NextResponse.json({
    restricted: false,
    permanent: false,
    bannedUntil: null,
  });
}
