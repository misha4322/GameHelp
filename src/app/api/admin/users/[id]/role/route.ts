import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, ne } from "drizzle-orm";
import { requireAdminContext, parseAppRole, type AppRole } from "@/lib/admin-server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export const runtime = "nodejs";

const ROLES: AppRole[] = ["user", "moderator", "admin"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const c = await requireAdminContext();
  if (c.kind === "response") return c.res;

  const { id: targetId } = await params;
  if (!targetId) {
    return NextResponse.json({ error: "id обязателен" }, { status: 400 });
  }

  let body: { role?: string };
  try {
    body = (await req.json()) as { role?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const next = parseAppRole(body.role);
  if (!ROLES.includes(next)) {
    return NextResponse.json(
      { error: "role: user | moderator | admin" },
      { status: 400 }
    );
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetId),
    columns: { id: true, role: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  if (target.role === "admin" && next !== "admin") {
    const [row] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), ne(users.id, targetId)));
    if (Number(row.n) < 1) {
      return NextResponse.json(
        { error: "Сначала назначьте другого админа" },
        { status: 400 }
      );
    }
  }

  try {
    await db.update(users).set({ role: next }).where(eq(users.id, targetId));
    return NextResponse.json({ ok: true, role: next });
  } catch (e) {
    console.error("PATCH role", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
