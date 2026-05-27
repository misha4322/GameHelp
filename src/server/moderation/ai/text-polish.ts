/**
 * Правка пунктуации после цензуры (Google Gemini или OpenAI-совместимый API).
 */
import { geminiApiAvailable, geminiGenerateText, resolveAiProvider } from "./gemini-client";

export type PolishTextResult = {
  text: string | null;
  status: "ok" | "unchanged" | "failed" | "skipped";
};

const DEFAULT_SYSTEM_PROMPT =
  "Редактор RU: только запятые, точки, тире, заглавная в начале предложения. " +
  "Нельзя менять буквы внутри слов, нельзя удалять/добавлять слова, нельзя цензурировать мат — это уже сделал сервер. " +
  "Не используй зачёркивание, звёздочки вместо букв. " +
  "Если сомневаешься — оставь как есть. Ответ — только текст, без пояснений.";

function chatCompletionsUrl(): string {
  const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function requestTimeoutMs(): number {
  const parsed = Number(process.env.OPENAI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25_000;
}

function maxOutputTokens(inputLen: number): number {
  const cap = Number(process.env.OPENAI_MAX_TOKENS);
  if (Number.isFinite(cap) && cap > 0) return cap;
  return Math.min(1024, Math.max(128, Math.ceil(inputLen * 1.12)));
}

export function getAiPolishSystemPrompt(): string {
  const custom = process.env.GEMINI_POLISH_SYSTEM_PROMPT?.trim() || process.env.OPENAI_SYSTEM_PROMPT?.trim();
  return custom || DEFAULT_SYSTEM_PROMPT;
}

export function polishTextEnabled(): boolean {
  const raw = String(
    process.env.GEMINI_POLISH_ENABLED ?? process.env.OPENAI_POLISH_ENABLED ?? "0"
  )
    .trim()
    .toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (resolveAiProvider() === "gemini") return geminiApiAvailable();
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function normalizePolishOutput(trimmed: string, out: string): string {
  let text = out;
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("«") && text.endsWith("»"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

async function polishWithGemini(trimmed: string): Promise<PolishTextResult> {
  const { text: out, error, quotaExceeded } = await geminiGenerateText({
    systemInstruction: getAiPolishSystemPrompt(),
    userText: trimmed,
    maxOutputTokens: maxOutputTokens(trimmed.length),
    temperature: 0,
  });

  if (!out) {
    if (quotaExceeded) {
      console.warn("[ai-polish] gemini quota — пунктуация пропущена");
    } else {
      console.warn("[ai-polish] gemini failed:", error?.slice(0, 200));
    }
    return { text: null, status: "failed" };
  }

  const text = normalizePolishOutput(trimmed, out);
  if (!text || text.length > trimmed.length * 3) {
    return { text: null, status: "failed" };
  }
  if (text === trimmed) return { text, status: "unchanged" };
  return { text, status: "ok" };
}

async function polishWithOpenAI(trimmed: string): Promise<PolishTextResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { text: null, status: "skipped" };

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  try {
    const res = await fetch(chatCompletionsUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxOutputTokens(trimmed.length),
        messages: [
          { role: "system", content: getAiPolishSystemPrompt() },
          { role: "user", content: trimmed },
        ],
      }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[ai-polish] HTTP ${res.status}`, errBody.slice(0, 200));
      return { text: null, status: "failed" };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const text = normalizePolishOutput(trimmed, raw);
    if (!text || text.length > trimmed.length * 3) {
      return { text: null, status: "failed" };
    }
    if (text === trimmed) return { text, status: "unchanged" };
    return { text, status: "ok" };
  } catch (e) {
    console.warn("[ai-polish] request failed:", e instanceof Error ? e.message : e);
    return { text: null, status: "failed" };
  }
}

export async function polishTextPunctuation(text: string): Promise<PolishTextResult> {
  const trimmed = String(text ?? "").trim();
  if (!polishTextEnabled() || trimmed.length < 2) {
    return { text: null, status: "skipped" };
  }

  const maxChars = Number(process.env.GEMINI_POLISH_MAX_CHARS ?? process.env.OPENAI_POLISH_MAX_CHARS) || 12_000;
  if (trimmed.length > maxChars) {
    console.warn(`[ai-polish] text too long (${trimmed.length}), skipped`);
    return { text: null, status: "skipped" };
  }

  return resolveAiProvider() === "gemini" ? polishWithGemini(trimmed) : polishWithOpenAI(trimmed);
}
