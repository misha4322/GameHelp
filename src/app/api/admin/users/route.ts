import { NextRequest, NextResponse } from "next/server";
import { count, desc, ilike, or } from "drizzle-orm";
import { getStaffContext } from "@/lib/admin-server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export const runtime = "nodejs";

const PAGE = 10;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
  const q = (searchParams.get("q") || "").trim();
  const filter = q
    ? or(ilike(users.username, `%${q}%`), ilike(users.email, `%${q}%`))
    : undefined;

  try {
    const listQ = db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        isBanned: users.isBanned,
        createdAt: users.createdAt,
      })
      .from(users);
    const countQ = db.select({ n: count() }).from(users);
    const [rows, totalRow] = await Promise.all([
      (filter ? listQ.where(filter) : listQ)
        .orderBy(desc(users.createdAt))
        .limit(PAGE)
        .offset((page - 1) * PAGE),
      filter ? countQ.where(filter) : countQ,
    ]);

    return NextResponse.json({
      users: rows.map((u) => ({
        ...u,
        createdAt: u.createdAt ? u.createdAt.toISOString() : null,
      })),
      page,
      pageSize: PAGE,
      total: Number(totalRow[0]?.n ?? 0),
    });
  } catch (e) {
    console.error("GET /api/admin/users", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
