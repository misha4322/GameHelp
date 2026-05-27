import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { resolveUserUuid } from "@/lib/user-utils";
import { ensureDirectConversation } from "@/server/services/messages";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = session ? await resolveUserUuid(session) : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { friendId } = await params;
  try {
    const conversation = await ensureDirectConversation(userId, friendId);
    return NextResponse.json({ conversation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: message.includes("друз") ? 403 : 500 });
  }
}

