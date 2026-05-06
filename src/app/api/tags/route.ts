import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { requireAdminContext } from "@/lib/admin-server";
import { db } from "@/server/db";
import { tags } from "@/server/db/schema";
import { defaultGameTags } from "@/server/config/default-game-tags";

export const runtime = "nodejs";

async function ensureDefaultTagsInDb() {
  const existing = await db.select({ name: tags.name }).from(tags);
  const existingNames = new Set(existing.map((item) => item.name.toLowerCase()));

  const missing = defaultGameTags
    .map((item) => item.name.trim())
    .filter((name) => !!name && !existingNames.has(name.toLowerCase()))
    .map((name) => ({ name }));

  if (missing.length > 0) {
    await db.insert(tags).values(missing).onConflictDoNothing();
  }
}

export async function GET() {
  try {
    await ensureDefaultTagsInDb();
    const list = await db.select().from(tags).orderBy(asc(tags.name));
    return NextResponse.json(list);
  } catch (error) {
    console.error("GET /api/tags error:", error);
    return NextResponse.json({ error: "Не удалось загрузить теги" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const c = await requireAdminContext();
  if (c.kind === "response") return c.res;

  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 50) {
    return NextResponse.json(
      { error: "Название тега: от 2 до 50 символов" },
      { status: 400 }
    );
  }

  try {
    const inserted = await db.insert(tags).values({ name }).returning({ id: tags.id, name: tags.name });
    const row = inserted[0];
    if (!row) {
      return NextResponse.json({ error: "Не удалось создать тег" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, tag: row });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code === "23505" || msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Такой тег уже существует" }, { status: 409 });
    }
    console.error("POST /api/tags", e);
    return NextResponse.json({ error: "Ошибка" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const c = await requireAdminContext();
  if (c.kind === "response") return c.res;

  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Параметр id обязателен" }, { status: 400 });
  }

  try {
    const deleted = await db.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
    if (!deleted.length) {
      return NextResponse.json({ error: "Тег не найден" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/tags", e);
    return NextResponse.json({ error: "Ошибка удаления" }, { status: 500 });
  }
}
