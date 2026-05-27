import { NextResponse } from "next/server";

import {
  HOME_FOR_YOU_DEFAULT_LIMIT,
  RECOMMENDATIONS_API_MAX_LIMIT,
} from "@/lib/recommendations-display";
import { getRecommendationsHome } from "@/server/services/recommendations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const viewerId = searchParams.get("viewerId")?.trim() || null;
    const raw = Number(searchParams.get("limit") ?? HOME_FOR_YOU_DEFAULT_LIMIT);
    const limit = Math.max(
      3,
      Math.min(RECOMMENDATIONS_API_MAX_LIMIT, Number.isFinite(raw) ? raw : HOME_FOR_YOU_DEFAULT_LIMIT)
    );
    const data = await getRecommendationsHome(viewerId, limit);
    return NextResponse.json(data);
  } catch (e) {
    console.error("GET /api/recommendations/home", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
