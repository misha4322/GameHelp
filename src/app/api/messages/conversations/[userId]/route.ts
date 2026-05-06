import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { resolveUserUuid } from "@/lib/user-utils";
import { getConversationsListPayload } from "@/server/api/messages";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const session = await getServerSession(authOptions);
  const myId = session ? await resolveUserUuid(session) : null;
  if (!myId || myId !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getConversationsListPayload(userId);
    return NextResponse.json(data);
  } catch (e) {
    console.error("GET /api/messages/conversations/[userId] error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
