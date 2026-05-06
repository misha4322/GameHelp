import { Elysia, t } from "elysia";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { users } from "../db/schema";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string) {
  return username.trim().replace(/\s+/g, " ").slice(0, 32);
}

function isValidUsername(username: string) {
  if (username.length < 3 || username.length > 32) {
    return false;
  }

  return /^[\p{L}\p{N} _.-]+$/u.test(username);
}

export const authRouter = new Elysia({ prefix: "/auth" })
  .post(
    "/login",
    async ({ body, set }) => {
      const email = normalizeEmail(body.email);

      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user || !user.passwordHash) {
        set.status = 401;
        return { error: "Неверный email или пароль" };
      }

      const ok = await bcrypt.compare(body.password, user.passwordHash);
      if (!ok) {
        set.status = 401;
        return { error: "Неверный email или пароль" };
      }

      return {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl ?? null,
      };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
    }
  )
  .post(
    "/register",
    async ({ body, set }) => {
      const email = normalizeEmail(body.email);
      const username = normalizeUsername(body.username);
      const password = body.password;

      if (!email || !username || !password) {
        set.status = 400;
        return { error: "Заполните все поля" };
      }

      if (!isValidUsername(username)) {
        set.status = 400;
        return {
          error: "Ник: 3–32 символа. Можно буквы, цифры, пробел, _ - .",
        };
      }

      if (password.length < 6) {
        set.status = 400;
        return { error: "Пароль должен быть не короче 6 символов" };
      }

      const byEmail = await db.query.users.findFirst({
        where: eq(users.email, email),
        columns: { id: true },
      });

      if (byEmail) {
        set.status = 400;
        return { error: "Пользователь с таким email уже существует" };
      }

      const byUsername = await db.query.users.findFirst({
        where: eq(users.username, username),
        columns: { id: true },
      });

      if (byUsername) {
        set.status = 409;
        return { error: "Этот ник уже занят" };
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const inserted = await db
        .insert(users)
        .values({
          email,
          username,
          passwordHash,
          provider: "local",
        })
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          avatarUrl: users.avatarUrl,
        });

      return {
        success: true,
        user: inserted[0],
      };
    },
    {
      body: t.Object({
        email: t.String(),
        username: t.String(),
        password: t.String(),
      }),
    }
  );