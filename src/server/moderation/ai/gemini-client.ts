/**
 * Google Gemini API (Generative Language API).
 * Ключ: GOOGLE_GEMINI_API_KEY или GEMINI_API_KEY
 * Модель Gemma 4 31B: gemma-4-31b-it
 */

export type GeminiConfig = {
  apiKey: string;
  model: string;
};

export type GeminiGenerateResult = {
  text: string | null;
  error?: string;
  statusCode?: number;
  quotaExceeded?: boolean;
};

let quotaBlockedUntilMs = 0;

export function getGeminiConfig(): GeminiConfig | null {
  const apiKey = (process.env.GOOGLE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const model = (process.env.GEMINI_MODEL ?? "gemma-4-31b-it").trim();
  return { apiKey, model };
}

export function geminiEnabled(): boolean {
  return getGeminiConfig() != null;
}

export function resetGeminiQuotaCooldown(): void {
  quotaBlockedUntilMs = 0;
}

function quotaCooldownIgnored(): boolean {
  const raw = String(process.env.GEMINI_IGNORE_QUOTA_COOLDOWN ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** После HTTP 429 не дергаем API, только regex на сайте. */
export function geminiQuotaBlocked(): boolean {
  if (quotaCooldownIgnored()) return false;
  return Date.now() < quotaBlockedUntilMs;
}

export function geminiApiAvailable(): boolean {
  return geminiEnabled() && !geminiQuotaBlocked();
}

function markQuotaExceeded(): void {
  const sec = Number(process.env.GEMINI_QUOTA_COOLDOWN_SEC);
  if (!Number.isFinite(sec) || sec <= 0) {
    console.warn("[gemini] HTTP 429 — пауза отключена (GEMINI_QUOTA_COOLDOWN_SEC=0), повтор сразу");
    return;
  }
  quotaBlockedUntilMs = Date.now() + sec * 1000;
  console.warn(`[gemini] quota 429 — пауза ${sec}с`);
}

export type AiProvider = "gemini" | "openai";

export function resolveAiProvider(): AiProvider {
  const raw = String(process.env.AI_PROVIDER ?? "auto").trim().toLowerCase();
  if (raw === "gemini") return "gemini";
  if (raw === "openai") return "openai";
  return geminiEnabled() ? "gemini" : "openai";
}

/** JSON mode поддерживают Gemini; у Gemma — только текст, парсим на сервере. */
export function geminiSupportsJsonMode(model: string): boolean {
  return /^gemini/i.test(model);
}

function geminiTimeoutMs(): number {
  const n = Number(process.env.GEMINI_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

function apiBaseUrl(): string {
  const custom = process.env.GEMINI_API_BASE_URL?.trim();
  if (custom) return custom.replace(/\/+$/, "");
  return "https://generativelanguage.googleapis.com";
}

function extractTextFromResponse(data: {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; code?: number };
}): string {
  const candidate = data.candidates?.[0];
  if (!candidate) return "";

  const parts = candidate.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  if (!text && candidate.finishReason === "SAFETY") {
    return "";
  }

  return text;
}

function formatFetchError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts = [e.message];
  const cause = (e as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) parts.push(cause.message);
  else if (cause != null) parts.push(String(cause));
  return parts.join(" | ");
}

export async function geminiGenerateText(params: {
  systemInstruction: string;
  userText: string;
  jsonMode?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<GeminiGenerateResult> {
  if (geminiQuotaBlocked()) {
    return {
      text: null,
      error: "Квота Gemini: пауза после 429, работают только правила сайта",
      quotaExceeded: true,
    };
  }

  const cfg = getGeminiConfig();
  if (!cfg) return { text: null, error: "GOOGLE_GEMINI_API_KEY не задан" };

  const url = `${apiBaseUrl()}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;

  const generationConfig: Record<string, unknown> = {
    temperature: params.temperature ?? 0,
    maxOutputTokens: params.maxOutputTokens ?? 1024,
  };
  if (params.jsonMode && geminiSupportsJsonMode(cfg.model)) {
    generationConfig.responseMimeType = "application/json";
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: params.userText }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(geminiTimeoutMs()),
    });

    const bodyText = await res.text().catch(() => "");

    if (!res.ok) {
      const quotaExceeded = res.status === 429;
      if (quotaExceeded) markQuotaExceeded();
      return {
        text: null,
        statusCode: res.status,
        quotaExceeded,
        error: `HTTP ${res.status}: ${bodyText.slice(0, 350)}`,
      };
    }

    let data: Parameters<typeof extractTextFromResponse>[0];
    try {
      data = JSON.parse(bodyText) as Parameters<typeof extractTextFromResponse>[0];
    } catch {
      return { text: null, error: "Некорректный JSON от Gemini" };
    }

    if (data.error?.message) {
      const quotaExceeded = data.error.code === 429;
      if (quotaExceeded) markQuotaExceeded();
      return { text: null, error: data.error.message, quotaExceeded };
    }

    const text = extractTextFromResponse(data);
    if (!text) {
      const reason = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason;
      return {
        text: null,
        error: reason ? `Пустой ответ Gemini (${reason})` : "Пустой ответ Gemini",
      };
    }

    return { text };
  } catch (e) {
    const msg = formatFetchError(e);
    console.warn(`[gemini] fetch failed model=${cfg.model}:`, msg);
    return {
      text: null,
      error: `Сеть: ${msg}. Проверьте интернет/VPN до generativelanguage.googleapis.com`,
    };
  }
}

/** Проверка связи с Google (для диагностики). */
export async function geminiPing(): Promise<{ ok: boolean; model?: string; error?: string }> {
  const cfg = getGeminiConfig();
  if (!cfg) return { ok: false, error: "GOOGLE_GEMINI_API_KEY не задан" };

  const { text, error } = await geminiGenerateText({
    systemInstruction: 'Ответь одним словом: OK',
    userText: "ping",
    maxOutputTokens: 16,
  });

  return { ok: Boolean(text), model: cfg.model, error: error ?? undefined };
}
