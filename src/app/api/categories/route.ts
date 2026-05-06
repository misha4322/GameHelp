import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";

import { db } from "@/server/db";
import { categories } from "@/server/db/schema";

export const runtime = "nodejs";

export async function GET() {
  try {
    const list = await db
      .select({
        id: categories.id,
        title: categories.title,
        slug: categories.slug,
      })
      .from(categories)
      .orderBy(asc(categories.title));
    return NextResponse.json({ categories: list });
  } catch (e) {
    console.error("GET /api/categories", e);
    return NextResponse.json({ error: "Ошибка загрузки категорий" }, { status: 500 });
  }
}
