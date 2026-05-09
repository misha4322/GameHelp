import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { recordUserPostRecSignal } from "@/server/recommendation-signals";
import type { RecommendationBlockName } from "@/types/recommendations";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const body = (await req.json().catch(() => ({}))) as {
      viewerId?: string | null;
      postId?: string;
      block?: RecommendationBlockName;
      eventType?: "impression" | "click";
    };

    const viewerId = typeof body.viewerId === "string" ? body.viewerId.trim() : "";
    const postId = typeof body.postId === "string" ? body.postId.trim() : "";
    const eventType = body.eventType;

    if (!viewerId || !UUID_RE.test(viewerId)) {
      return NextResponse.json({ error: "Нужен viewerId" }, { status: 400 });
    }
    if (!session?.user?.id || session.user.id !== viewerId) {
      return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
    }
    if (!postId || !UUID_RE.test(postId)) {
      return NextResponse.json({ error: "Нужен postId" }, { status: 400 });
    }
    if (eventType !== "impression" && eventType !== "click") {
      return NextResponse.json({ error: "eventType: impression | click" }, { status: 400 });
    }

    await recordUserPostRecSignal(viewerId, postId, eventType);

    return NextResponse.json({
      success: true,
      loggedAt: new Date().toISOString(),
      event: {
        viewerId,
        postId,
        block: body.block ?? null,
        eventType,
      },
    });
  } catch (e) {
    console.error("POST /api/recommendations/event", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
