import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getStaffContext } from "@/lib/admin-server";
import { db } from "@/server/db";
import { contentReports } from "@/server/db/schema";

export const runtime = "nodejs";

/** Убрать жалобу из очереди после разбора */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "id обязателен" }, { status: 400 });
  }

  try {
    await db.delete(contentReports).where(eq(contentReports.id, id.trim()));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/admin/reports/[id]", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
