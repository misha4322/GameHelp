import { NextResponse } from "next/server";

import type { RecommendationBlockName } from "@/types/recommendations";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      viewerId?: string | null;
      postId?: string;
      block?: RecommendationBlockName;
      eventType?: "impression" | "click";
    };

    return NextResponse.json({
      success: true,
      loggedAt: new Date().toISOString(),
      event: {
        viewerId: body.viewerId ?? null,
        postId: body.postId ?? null,
        block: body.block ?? null,
        eventType: body.eventType ?? null,
      },
    });
  } catch (e) {
    console.error("POST /api/recommendations/event", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
