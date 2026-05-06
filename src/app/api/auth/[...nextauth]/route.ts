import NextAuth, { type NextAuthOptions } from "next-auth";
import Steam from "next-auth-steam";
import type { NextRequest } from "next/server";

import { getAuthOptionsForRoute } from "@/lib/auth-options";

export const runtime = "nodejs";

function buildOptions(req: NextRequest): NextAuthOptions {
  const base = getAuthOptionsForRoute();
  const options: NextAuthOptions = {
    ...base,
    providers: [...(base.providers ?? [])],
  };

  const steamSecret = process.env.STEAM_SECRET;
  if (steamSecret?.trim()) {
    options.providers?.push(Steam(req, { clientSecret: steamSecret }));
  }

  return options;
}

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ nextauth: string[] }> }
) {
  return NextAuth(req, ctx, buildOptions(req));
}

export { handler as GET, handler as POST };
