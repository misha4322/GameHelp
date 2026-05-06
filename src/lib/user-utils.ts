// lib/user-utils.ts
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * Проверяет, является ли строка валидным UUID.
 */
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Извлекает внутренний UUID пользователя из сессии.
 * Работает для:
 * - Credentials (в сессии уже лежит UUID)
 * - OAuth провайдеров (Google, Yandex, Steam) – ищет по providerId или email
 */
export async function resolveUserUuid(session: any): Promise<string | null> {
  const rawId = session?.user?.id ? String(session.user.id) : null;
  if (!rawId) return null;

  // 1) Если это уже UUID — используем напрямую
  if (isUuid(rawId)) return rawId;

  // 2) Иначе пробуем найти пользователя по providerId
  //    (это идентификатор от Google, Yandex, Steam и т.д.)
  const byProviderId = await db.query.users.findFirst({
    where: eq(users.providerId, rawId),
  });
  if (byProviderId) return byProviderId.id;

  // 3) Фолбэк: поиск по email (для Google / Yandex)
  const email = session?.user?.email ? String(session.user.email).toLowerCase() : null;
  if (email) {
    const byEmail = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (byEmail) return byEmail.id;
  }

  return null;
}