import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";
import * as path from "path";

// Загружаем .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Если не нашли, пробуем .env
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL не найден. Проверь .env.local или .env");
}

export default {
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;