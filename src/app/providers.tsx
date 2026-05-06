"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

import { BanRestrictionProvider } from "@/contexts/BanRestrictionContext";

export function AuthProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      <BanRestrictionProvider>{children}</BanRestrictionProvider>
    </SessionProvider>
  );
}
