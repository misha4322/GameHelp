import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { resolveUserUuid } from "@/lib/user-utils";
import { markConversationRead } from "@/server/messages-service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session ? await resolveUserUuid(session) : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { conversationId?: string };
  if (!body.conversationId) return NextResponse.json({ error: "conversationId обязателен" }, { status: 400 });

  try {
    const data = await markConversationRead(body.conversationId, userId);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: message.includes("доступ") ? 403 : 500 });
  }
}

