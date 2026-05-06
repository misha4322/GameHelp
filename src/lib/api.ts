/**
 * База для API. В браузере по умолчанию тот же origin (туннель / LAN), иначе телефон
 * ходил бы на localhost:3001 и ничего не получал бы.
 */
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

  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Сервер вернул не JSON: ${text.slice(0, 200)}`);
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : `Ошибка запроса: ${response.status}`
    );
  }

  return data as T;
}