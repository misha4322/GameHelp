/**
 * Привязка «временного админа» по env (TEMP_ADMIN_USER_ID / TEMP_ADMIN_EMAIL).
 * Используется и в API (`getStaffContext`), и в сессии, чтобы навбар и JWT
 * совпадали с доступом к `/admin` после сброса БД или до выставления роли в таблице users.
 */
export function matchesTempAdminStaff(
  userId: string | null | undefined,
  email: string | null | undefined
): boolean {
  const bindUserId = process.env.TEMP_ADMIN_USER_ID?.trim();
  const bindEmail = process.env.TEMP_ADMIN_EMAIL?.trim().toLowerCase();
  const id = userId?.trim();
  const em = email?.trim().toLowerCase();

  if (bindUserId && id && bindUserId === id) return true;
  if (bindEmail && em && bindEmail === em) return true;
  return false;
}
