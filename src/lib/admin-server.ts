import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { canManageRoles, canViewAdminPanel, isAdminRole, parseAppRole, type AppRole } from "@/lib/roles";
import { matchesTempAdminStaff } from "@/lib/temp-admin-bind";

type StaffOk = {
  kind: "ok";
  userId: string;
  role: string;
  session: Session;
};

type StaffErr = { kind: "response"; res: NextResponse };

export function isTempAdminSession(session: Session) {
  return matchesTempAdminStaff(session.user?.id, session.user?.email);
}

export async function getStaffContext(): Promise<StaffOk | StaffErr> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { kind: "response", res: NextResponse.json({ error: "Нужен вход" }, { status: 401 }) };
  }
  const role = session.user.role ?? "user";
  const tempAdmin = isTempAdminSession(session);
  if (!canViewAdminPanel(role) && !tempAdmin) {
    return { kind: "response", res: NextResponse.json({ error: "Нет доступа" }, { status: 403 }) };
  }
  return { kind: "ok", userId: session.user.id, role, session };
}

export async function requireAdminContext(): Promise<StaffOk | StaffErr> {
  const c = await getStaffContext();
  if (c.kind === "response") return c;
  if (!isAdminRole(c.role) && !isTempAdminSession(c.session)) {
    return { kind: "response", res: NextResponse.json({ error: "Только для главного админа" }, { status: 403 }) };
  }
  return c;
}

export { parseAppRole, canManageRoles, type AppRole };
