import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { categories } from "@/server/db/schema";

export const runtime = "nodejs";

function steamSlug(appid: number) {
  return `steam-${appid}`;
}

/** Публично: есть ли категория с slug steam-{appid} (для фильтра ленты без записи в БД). */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const appid = Math.floor(Number(searchParams.get("appid") ?? ""));
    if (!Number.isFinite(appid) || appid <= 0) {
      return NextResponse.json({ error: "Нужен положительный appid" }, { status: 400 });
    }

    const slug = steamSlug(appid);
    const row = await db.query.categories.findFirst({
      where: eq(categories.slug, slug),
      columns: { id: true, title: true, slug: true },
    });

    return NextResponse.json({
      category: row ? { id: row.id, title: row.title, slug: row.slug } : null,
    });
  } catch (e) {
    console.error("GET /api/categories/by-steam", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
