import { NextRequest, NextResponse } from "next/server";
import { asc, count, desc, ilike, ne, or } from "drizzle-orm";
import { getStaffContext, requireAdminContext } from "@/lib/admin-server";
import { isChiefAdmin, ONLY_CHIEF_CAN_TRANSFER } from "@/server/chief-admin";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export const runtime = "nodejs";

const PAGE = 10;
const CHIEF_PICK_LIMIT = 2000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get("chiefTransferPick") === "1") {
    const c = await requireAdminContext();
    if (c.kind === "response") return c.res;
    if (!(await isChiefAdmin(c.userId))) {
      return NextResponse.json({ error: ONLY_CHIEF_CAN_TRANSFER }, { status: 403 });
    }
    try {
      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
        })
        .from(users)
        .where(ne(users.id, c.userId))
        .orderBy(asc(users.username))
        .limit(CHIEF_PICK_LIMIT);
      return NextResponse.json({
        pickList: rows.map((r) => ({
          id: r.id,
          username: r.username,
          email: r.email ?? null,
        })),
      });
    } catch (e) {
      console.error("GET /api/admin/users chiefTransferPick", e);
      return NextResponse.json({ error: "Ошибка" }, { status: 500 });
    }
  }

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
