import bcrypt from "bcrypt";
import { NextResponse } from "next/server";
import { db } from "../../../../server/db";
import { users } from "../../../../server/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const { username, email, password } = await req.json();

    if (!email || !password || !username) {
      return NextResponse.json({ error: "Заполните все поля" }, { status: 400 });
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email), 
    });

    if (existingUser) {
      return NextResponse.json({ error: "Пользователь с таким email уже существует" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await db.insert(users).values({
      username,
      email,
      passwordHash,
      provider: "local",
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Ошибка регистрации:", err);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
