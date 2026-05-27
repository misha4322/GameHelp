/**
 * Прокси на Elysia (:3001) — там загружается .env.local и идут запросы к Gemini.
 */
import { NextResponse } from "next/server";

const API_ORIGIN = process.env.API_INTERNAL_ORIGIN ?? "http://127.0.0.1:3001";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.text();
  try {
    const res = await fetch(`${API_ORIGIN}/api/moderation/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(115_000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ?
            `API недоступен (${API_ORIGIN}): ${e.message}`
          : "API недоступен",
      },
      { status: 502 }
    );
  }
}
