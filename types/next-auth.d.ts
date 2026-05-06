import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      username?: string | null;
      avatarUrl?: string | null;
      /** user | moderator | admin */
      role?: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    username?: string | null;
    avatarUrl?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    username?: string | null;
    avatarUrl?: string | null;
    email?: string | null;
    name?: string | null;
    picture?: string | null;
    role?: string;
  }
}

export {};