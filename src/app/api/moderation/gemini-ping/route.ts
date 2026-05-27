import { NextResponse } from "next/server";

import { geminiPing } from "@/server/moderation/ai/gemini-client";

import "@/server/config/load-env";

export const runtime = "nodejs";

/** Диагностика: всегда 200 + JSON, чтобы в DevTools не было ложного «Service Unavailable». */
export async function GET() {
  const result = await geminiPing();
  return NextResponse.json(result);
}
