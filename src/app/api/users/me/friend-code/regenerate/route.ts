import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

async function generateFriendCode() {
  while (true) {
    const code = `${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.friendCode, code))
      .limit(1);
    if (!rows[0]) return code;
  }
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await resolveUserUuid(session);
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  try {
    const newCode = await generateFriendCode();
    await db.update(users).set({ friendCode: newCode }).where(eq(users.id, userId));
    return NextResponse.json({ success: true, friendCode: newCode });
  } catch (e) {
    console.error("POST /api/users/me/friend-code/regenerate", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
