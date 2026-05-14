/**
 * База для API. В браузере по умолчанию тот же origin (туннель / LAN), иначе телефон
 * ходил бы на localhost:3001 и ничего не получал бы.
 */
import type { ModerationTextMatch } from "./moderation/moderate-text";

function getApiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/api`;
  }
  return "http://127.0.0.1:3001/api";
}

export const API_URL = getApiBase();

type QueryValue = string | number | boolean | null | undefined;

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBase();
  const url = new URL(`${base}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function parseModerationMatches(raw: unknown): ModerationTextMatch[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ModerationTextMatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o.ruleId === "string" &&
      typeof o.start === "number" &&
      typeof o.end === "number" &&
      typeof o.text === "string" &&
      (o.action === "block" || o.action === "censor") &&
      (o.severity === "low" || o.severity === "medium" || o.severity === "high")
    ) {
      out.push({
        ruleId: o.ruleId,
        phrase: typeof o.phrase === "string" ? o.phrase : "",
        maskedPhrase: typeof o.maskedPhrase === "string" ? o.maskedPhrase : "",
        action: o.action,
        severity: o.severity,
        start: o.start,
        end: o.end,
        text: o.text,
      });
    }
  }
  return out.length ? out : undefined;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly matches?: ModerationTextMatch[],
    public readonly sourceField?: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T = any>(
  path: string,
  init: RequestInit & {
    query?: Record<string, QueryValue>;
  } = {}
): Promise<T> {
  const { query, headers, body, ...rest } = init;

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    body,
    cache: rest.cache ?? "no-store",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(headers ?? {}),
    },
  });

  const text = await response.text();

  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Сервер вернул не JSON: ${text.slice(0, 200)}`);
    }
  }

  if (!response.ok) {
    const msg =
      typeof data.error === "string" ? data.error : `Ошибка запроса: ${response.status}`;
    const code = typeof data.code === "string" ? data.code : undefined;
    const matches = parseModerationMatches(data.matches);
    const sourceField = typeof data.sourceField === "string" ? data.sourceField : undefined;
    throw new ApiRequestError(msg, response.status, code, matches, sourceField);
  }

  return data as T;
}
