import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { resolveUserUuid } from "@/lib/user-utils";
import { sendMessagePayload } from "@/server/messages-service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session ? await resolveUserUuid(session) : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    conversationId?: string | null;
    targetUserId?: string | null;
    content?: string | null;
    sharedPostId?: string | null;
    imageUrl?: string | null;
    replyToId?: string | null;
  };

  try {
    const data = await sendMessagePayload({
      userId,
      conversationId: body.conversationId,
      targetUserId: body.targetUserId,
      content: body.content,
      sharedPostId: body.sharedPostId,
      imageUrl: body.imageUrl,
      replyToId: body.replyToId,
    });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: message.includes("доступ") || message.includes("друз") ? 403 : 500 });
  }
}

