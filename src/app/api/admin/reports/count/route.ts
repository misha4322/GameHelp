import { count } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getStaffContext } from "@/lib/admin-server";
import { db } from "@/server/db";
import { contentReports } from "@/server/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  try {
    const [row] = await db.select({ n: count() }).from(contentReports);
    return NextResponse.json({ count: Number(row?.n ?? 0) });
  } catch (e) {
    console.error("GET /api/admin/reports/count", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
