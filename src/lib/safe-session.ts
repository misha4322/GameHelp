import { getServerSession } from "next-auth";
import type { Session } from "next-auth";

import { authOptions } from "@/lib/auth-options";

/**
 * Не роняет RSC при сбое БД / NextAuth — возвращает null.
 */
export async function getServerSessionSafe(): Promise<Session | null> {
  try {
    return await getServerSession(authOptions);
  } catch (error) {
    console.error("[auth] getServerSession failed:", error);
    return null;
  }
}
