/** Безопасный разбор ответа API — не падаем на HTML-странице 404/502 от Next. */
export async function parseApiJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const trimmed = text.trim();

  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("<") || trimmed.startsWith("<!")) {
    throw new Error(
      "Сервер вернул HTML вместо JSON. Запустите backend: `npm run dev` или `npm run build` и затем `npm start` (нужны порты 3000 и 3001)."
    );
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Ответ не JSON (HTTP ${res.status}). Проверьте, что API на :3001 запущен.`
    );
  }
}
