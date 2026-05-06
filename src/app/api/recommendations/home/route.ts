import { NextResponse } from "next/server";

import { getRecommendationsHome } from "@/server/recommendations-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const viewerId = searchParams.get("viewerId")?.trim() || null;
    const limit = Number(searchParams.get("limit") ?? 6);
    const data = await getRecommendationsHome(viewerId, limit);
    return NextResponse.json(data);
  } catch (e) {
    console.error("GET /api/recommendations/home", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
