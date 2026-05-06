import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { categories } from "@/server/db/schema";

export const runtime = "nodejs";

function steamSlug(appid: number) {
  return `steam-${appid}`;
}

/** Создать категорию по игре Steam (для фильтра / постов). Требуется вход. */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Нужна авторизация" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { appid?: unknown; name?: unknown };
    const appid = Math.floor(Number(body.appid));
    const name = String(body.name ?? "").trim().slice(0, 100);
    if (!Number.isFinite(appid) || appid <= 0 || !name) {
      return NextResponse.json({ error: "Укажите appid и название игры" }, { status: 400 });
    }

    const slug = steamSlug(appid);

    const existing = await db.query.categories.findFirst({
      where: eq(categories.slug, slug),
      columns: { id: true, title: true, slug: true },
    });
    if (existing) {
      return NextResponse.json({
        category: { id: existing.id, title: existing.title, slug: existing.slug },
      });
    }

    try {
      const inserted = await db
        .insert(categories)
        .values({
          title: name,
          slug,
          description: null,
        })
        .returning({ id: categories.id, title: categories.title, slug: categories.slug });

      const row = inserted[0];
      return NextResponse.json({
        category: { id: row.id, title: row.title, slug: row.slug },
      });
    } catch (insertErr) {
      const again = await db.query.categories.findFirst({
        where: eq(categories.slug, slug),
        columns: { id: true, title: true, slug: true },
      });
      if (again) {
        return NextResponse.json({
          category: { id: again.id, title: again.title, slug: again.slug },
        });
      }
      throw insertErr;
    }
  } catch (e) {
    console.error("POST /api/categories/from-steam", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
