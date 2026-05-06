import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { count, eq } from "drizzle-orm";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export const runtime = "nodejs";

/**
 * Одноразово: пока в БД нет ни одного `admin`, текущий пользователь становится админом
 * (если передан `Authorization: Bearer <ADMIN_BOOTSTRAP_SECRET>`).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_BOOTSTRAP_SECRET не настроен в .env" },
      { status: 503 }
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Неверный secret" }, { status: 401 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Сначала войдите в сайт" }, { status: 401 });
  }

  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.role, "admin"));
  if (Number(row.n) > 0) {
    return NextResponse.json(
      { error: "Админ уже назначен — заходите в панель" },
      { status: 400 }
    );
  }

  try {
    await db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, session.user.id));
    return NextResponse.json({ ok: true, userId: session.user.id, role: "admin" });
  } catch (e) {
    console.error("POST bootstrap", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}
