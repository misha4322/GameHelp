import { asc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { users } from "@/server/db/schema";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Главный админ:
 * - `ADMIN_OWNER_USER_ID` (UUID в .env), если такой пользователь существует и его роль admin;
 * - иначе админ с самым ранним `createdAt` в БД (обычно первый bootstrap).
 */
export async function resolveChiefAdminUserId(): Promise<string | null> {
  const raw = process.env.ADMIN_OWNER_USER_ID?.trim();
  if (raw && isUuid(raw)) {
    const pinned = await db.query.users.findFirst({
      where: eq(users.id, raw),
      columns: { id: true, role: true },
    });
    if (pinned?.role === "admin") return pinned.id;
  }

  const oldest = await db.query.users.findFirst({
    where: eq(users.role, "admin"),
    columns: { id: true },
    orderBy: [asc(users.createdAt)],
  });

  return oldest?.id ?? null;
}
