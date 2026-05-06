import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { getStaffContext } from "@/lib/admin-server";
import { resolveChiefAdminUserId } from "@/server/chief-admin";
import { db } from "@/server/db";
import { users, posts } from "@/server/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  try {
    const [userRow, postRow, adminRow, bannedRow] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(posts),
      db.select({ n: count() }).from(users).where(eq(users.role, "admin")),
      db.select({ n: count() }).from(users).where(eq(users.isBanned, true)),
    ]);

    const chiefAdminId = await resolveChiefAdminUserId();

    return NextResponse.json({
      users: Number(userRow[0]?.n ?? 0),
      posts: Number(postRow[0]?.n ?? 0),
      admins: Number(adminRow[0]?.n ?? 0),
      bannedUsers: Number(bannedRow[0]?.n ?? 0),
      chiefAdminId,
    });
  } catch (e) {
    console.error("GET /api/admin/stats", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
