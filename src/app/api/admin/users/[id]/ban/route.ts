import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getStaffContext } from "@/lib/admin-server";
import { BAN_IMMUNE_MESSAGE, isBanImmuneRole } from "@/lib/roles";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const c = await getStaffContext();
  if (c.kind === "response") return c.res;

  const { id: targetId } = await params;
  if (!targetId) {
    return NextResponse.json({ error: "id обязателен" }, { status: 400 });
  }
  if (targetId === c.userId) {
    return NextResponse.json({ error: "Нельзя банить себя" }, { status: 400 });
  }

  let body: { banned?: boolean };
  try {
    body = (await req.json()) as { banned?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.banned !== "boolean") {
    return NextResponse.json({ error: "Нужен banned: true|false" }, { status: 400 });
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetId),
    columns: { id: true, role: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }
  if (body.banned && isBanImmuneRole(target.role)) {
    return NextResponse.json({ error: BAN_IMMUNE_MESSAGE }, { status: 403 });
  }

  try {
    await db
      .update(users)
      .set(
        body.banned
          ? { isBanned: true }
          : { isBanned: false, bannedUntil: null }
      )
      .where(eq(users.id, targetId));
    return NextResponse.json({ ok: true, banned: body.banned });
  } catch (e) {
    console.error("PATCH ban", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
