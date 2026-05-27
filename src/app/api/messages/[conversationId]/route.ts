import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { resolveUserUuid } from "@/lib/user-utils";
import { getConversationMessagesPayload } from "@/server/services/messages";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = session ? await resolveUserUuid(session) : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  const before = url.searchParams.get("before");
  const after = url.searchParams.get("after");

  try {
    const data = await getConversationMessagesPayload(conversationId, userId, {
      limit,
      before,
      after,
    });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: message.includes("доступ") ? 403 : 500 });
  }
}

