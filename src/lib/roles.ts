/** Роли: user — обычный, moderator — модерация, admin — полные права в панели. */
export type AppRole = "user" | "moderator" | "admin";

const VALID: Set<string> = new Set(["user", "moderator", "admin"]);

export function parseAppRole(v: string | null | undefined): AppRole {
  if (v && VALID.has(v)) return v as AppRole;
  return "user";
}

export function isAdminRole(v: string | null | undefined): boolean {
  return v === "admin";
}

export function isStaffRole(v: string | null | undefined): boolean {
  return v === "admin" || v === "moderator";
}

export function canManageRoles(v: string | null | undefined): boolean {
  return v === "admin";
}

export function canViewAdminPanel(v: string | null | undefined): boolean {
  return isStaffRole(v);
}

export function canModerateUsers(v: string | null | undefined): boolean {
  return isStaffRole(v);
}

/** Учётные записи admin нельзя блокировать (ни модератором, ни другим админом). */
export function isBanImmuneRole(role: string | null | undefined): boolean {
  return role === "admin";
}

export const BAN_IMMUNE_MESSAGE = "Нельзя блокировать администратора";
