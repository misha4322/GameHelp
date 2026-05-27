import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { resolveUserUuid } from "@/lib/user-utils";
import { reportMessage } from "@/server/services/messages";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session ? await resolveUserUuid(session) : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    conversationId?: string;
    messageId?: string;
    reason?: string;
  };
  if (!body.conversationId || !body.messageId) {
    return NextResponse.json({ error: "conversationId и messageId обязательны" }, { status: 400 });
  }

  try {
    const data = await reportMessage(body.conversationId, body.messageId, userId, body.reason);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: message.includes("доступ") ? 403 : 500 });
  }
}

