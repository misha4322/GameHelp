import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import YandexProvider from "next-auth/providers/yandex";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { eq, and } from "drizzle-orm";

import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { parseAppRole } from "@/lib/roles";
import { matchesTempAdminStaff } from "@/lib/temp-admin-bind";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function makeUniqueUsername(rawName: string) {
  const base = rawName.trim().slice(0, 32) || "user";

  let username = base;
  let i = 0;

  while (true) {
    const existing = await db.query.users.findFirst({
      where: eq(users.username, username),
      columns: { id: true },
    });

    if (!existing) {
      return username;
    }

    i += 1;
    const suffix = `_${i}`;
    username = `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
  }
}

async function findUserForOAuth(params: {
  email: string | null;
  provider: string;
  providerId: string;
}) {
  const { email, provider, providerId } = params;

  if (email) {
    const byEmail = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (byEmail) {
      return byEmail;
    }
  }

  const byProvider = await db.query.users.findFirst({
    where: and(eq(users.provider, provider), eq(users.providerId, providerId)),
  });

  return byProvider ?? null;
}

function buildBaseProviders(): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email ? normalizeEmail(credentials.email) : "";
        const password = credentials?.password ?? "";

        if (!email || !password) {
          return null;
        }

        try {
          const user = await db.query.users.findFirst({
            where: eq(users.email, email),
          });

          if (!user || !user.passwordHash) {
            return null;
          }

          const isValid = await bcrypt.compare(password, user.passwordHash);
          if (!isValid) {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            name: user.username,
            image: user.avatarUrl ?? undefined,
          };
        } catch (error) {
          console.error("[next-auth] credentials authorize DB error:", error);
          return null;
        }
      },
    }),
  ];

  const googleId = process.env.GOOGLE_CLIENT_ID;
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (googleId && googleSecret) {
    providers.push(
      GoogleProvider({
        clientId: googleId,
        clientSecret: googleSecret,
      })
    );
  }

  const yandexId = process.env.YANDEX_CLIENT_ID;
  const yandexSecret = process.env.YANDEX_CLIENT_SECRET;
  if (yandexId && yandexSecret) {
    providers.push(
      YandexProvider({
        clientId: yandexId,
        clientSecret: yandexSecret,
      })
    );
  }

  return providers;
}

const callbacks: NextAuthOptions["callbacks"] = {
  async signIn({ user, account, profile }) {
    if (!account?.provider) {
      return false;
    }

    if (account.provider === "credentials") {
      return true;
    }

    try {
      const provider = account.provider;
      const providerId = account.providerAccountId;
      const email =
        provider !== "steam" && user.email ? normalizeEmail(user.email) : null;

      if (provider !== "steam" && !email) {
        return false;
      }

      const existing = await findUserForOAuth({
        email,
        provider,
        providerId,
      });

      if (!existing) {
        const rawName =
          user.name ??
          (profile as { personaname?: string })?.personaname ??
          `user_${provider}_${providerId.slice(0, 8)}`;

        const username = await makeUniqueUsername(rawName);

        await db.insert(users).values({
          email,
          username,
          provider,
          providerId,
          avatarUrl:
            user.image ?? (profile as { avatarfull?: string })?.avatarfull ?? null,
        });
      }

      return true;
    } catch (error) {
      console.error("[next-auth] signIn OAuth DB error:", error);
      return false;
    }
  },

  async jwt({ token, user, account }) {
    if (account?.provider) {
      if (account.provider === "credentials" && user?.id) {
        token.userId = user.id;
        token.email = user.email ?? null;
        token.name = user.name ?? null;
        token.picture = user.image ?? null;
        const row = await db.query.users.findFirst({
          where: eq(users.id, String(user.id)),
          columns: { role: true, email: true },
        });
        token.role = row?.role ?? "user";
        if (matchesTempAdminStaff(String(user.id), row?.email ?? user.email)) {
          token.role = "admin";
        }
        return token;
      }

      try {
        const provider = account.provider;
        const providerId = account.providerAccountId;
        const email = user?.email ? normalizeEmail(user.email) : null;

        const dbUser = await findUserForOAuth({
          email,
          provider,
          providerId,
        });

        if (dbUser) {
          token.userId = dbUser.id;
          token.email = dbUser.email ?? token.email ?? null;
          token.name = dbUser.username ?? token.name ?? null;
          token.picture = dbUser.avatarUrl ?? token.picture ?? null;
          token.role = dbUser.role;
          if (matchesTempAdminStaff(dbUser.id, dbUser.email)) {
            token.role = "admin";
          }
        }
      } catch (error) {
        console.error("[next-auth] jwt callback DB error:", error);
      }

      return token;
    }

    const uid = typeof token.userId === "string" ? token.userId : null;
    if (uid) {
      try {
        const row = await db.query.users.findFirst({
          where: eq(users.id, uid),
          columns: { role: true, email: true },
        });
        if (row) {
          token.role = row.role;
          token.email = (token.email as string | null) ?? row.email ?? null;
        }
        const emailForBind =
          (typeof token.email === "string" ? token.email : null) ?? row?.email ?? null;
        if (matchesTempAdminStaff(uid, emailForBind)) {
          token.role = "admin";
        }
      } catch (error) {
        console.error("[next-auth] jwt refresh role DB error:", error);
      }
    }

    return token;
  },

  async session({ session, token }) {
    const userId = typeof token.userId === "string" ? token.userId : null;

    if (!session.user || !userId) {
      return session;
    }

    session.user.id = userId;

    try {
      const dbUser = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: {
          id: true,
          email: true,
          username: true,
          avatarUrl: true,
          role: true,
        },
      });

      session.user.email = dbUser?.email ?? (token.email as string | null) ?? null;
      session.user.name = dbUser?.username ?? (token.name as string | null) ?? null;
      session.user.image =
        dbUser?.avatarUrl ?? (token.picture as string | null) ?? null;
      const emailForBind = session.user.email;
      let role = parseAppRole(
        dbUser?.role ?? (token.role as string | null) ?? "user"
      );
      if (matchesTempAdminStaff(userId, emailForBind)) {
        role = "admin";
      }
      session.user.role = role;
    } catch (error) {
      console.error("[next-auth] session callback DB error:", error);
      session.user.email = (token.email as string | null) ?? null;
      session.user.name = (token.name as string | null) ?? null;
      session.user.image = (token.picture as string | null) ?? null;
      let role = parseAppRole((token.role as string | null) ?? "user");
      if (matchesTempAdminStaff(userId, session.user.email)) {
        role = "admin";
      }
      session.user.role = role;
    }

    return session;
  },
};

const sessionPagesSecret: Pick<
  NextAuthOptions,
  "session" | "pages" | "secret" | "debug"
> = {
  session: {
    strategy: "jwt",
  },

  pages: {
    signIn: "/auth/login",
    signOut: "/",
    error: "/auth/error",
    newUser: "/auth/register",
  },

  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  /** `NEXTAUTH_DEBUG=true` — подробные логи; иначе в dev не засоряем консоль. */
  debug: process.env.NEXTAUTH_DEBUG === "true",
};

/**
 * Конфиг для `getServerSession`: список провайдеров внутри next-auth всё равно
 * обнуляется, OAuth здесь не нужен.
 */
export const authOptions: NextAuthOptions = {
  ...sessionPagesSecret,
  providers: [],
  callbacks,
};

/**
 * Полная конфигурация для route handler: провайдеры читают `process.env` при
 * каждом запросе, чтобы после `next build` + `next start` работали Google /
 * Яндекс (значения из `.env` на машине запуска, а не на этапе сборки).
 */
export function getAuthOptionsForRoute(): NextAuthOptions {
  return {
    ...sessionPagesSecret,
    providers: buildBaseProviders(),
    callbacks,
  };
}
