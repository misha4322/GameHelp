import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { resolveUserUuid } from "@/lib/user-utils";
import { pinMessage } from "@/server/messages-service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = session ? await resolveUserUuid(session) : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { messageId?: string };
  if (!body.messageId) return NextResponse.json({ error: "messageId обязателен" }, { status: 400 });

  const { conversationId } = await params;
  try {
    const data = await pinMessage(conversationId, body.messageId, userId);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: message.includes("доступ") ? 403 : 500 });
  }
}

