import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdminContext, parseAppRole, type AppRole } from "@/lib/admin-server";
import { isChiefAdmin, ONLY_CHIEF_CAN_TRANSFER } from "@/server/chief-admin";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export const runtime = "nodejs";

const AFTER: AppRole[] = ["user", "moderator"];

/**
 * Главный админ передаёт полномочия: другой пользователь → admin, вы — user или модератор.
 */
export async function POST(req: NextRequest) {
  const c = await requireAdminContext();
  if (c.kind === "response") return c.res;

  let body: { newAdminId?: string; yourNewRole?: string };
  try {
    body = (await req.json()) as { newAdminId?: string; yourNewRole?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newAdminId = String(body.newAdminId ?? "").trim();
  const yourNewRole = parseAppRole(body.yourNewRole) as AppRole;
  if (!newAdminId) {
    return NextResponse.json({ error: "newAdminId обязателен" }, { status: 400 });
  }
  if (!AFTER.includes(yourNewRole)) {
    return NextResponse.json(
      { error: "yourNewRole: user или moderator" },
      { status: 400 }
    );
  }
  if (newAdminId === c.userId) {
    return NextResponse.json({ error: "Укажите другого пользователя" }, { status: 400 });
  }

  const [incoming, you] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, newAdminId),
      columns: { id: true, role: true, username: true },
    }),
    db.query.users.findFirst({
      where: eq(users.id, c.userId),
      columns: { id: true, role: true },
    }),
  ]);
  if (!incoming) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }
  if (you?.role !== "admin") {
    return NextResponse.json({ error: "Передача только от админа" }, { status: 403 });
  }

  if (!(await isChiefAdmin(c.userId))) {
    return NextResponse.json({ error: ONLY_CHIEF_CAN_TRANSFER }, { status: 403 });
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ role: "admin" })
        .where(eq(users.id, newAdminId));
      await tx
        .update(users)
        .set({ role: yourNewRole })
        .where(eq(users.id, c.userId));
    });
  } catch (e) {
    console.error("POST transfer", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, newAdminId, yourNewRole });
}
