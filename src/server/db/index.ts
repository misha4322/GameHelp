import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const rootDir = process.cwd();
const envLocalPath = path.join(rootDir, ".env.local");
const envPath = path.join(rootDir, ".env");

// Сначала пробуем .env.local, потом .env
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL не найден. Добавь его в .env.local или .env для Elysia API."
  );
}
const databaseUrlValue: string = databaseUrl;


const globalForDb = globalThis as unknown as {
  __postgresClient?: ReturnType<typeof postgres>;
  __drizzleDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function getPoolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX;
  if (raw !== undefined) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return Math.min(50, n);
  }
  return process.env.NODE_ENV === "development" ? 4 : 10;
}

function createQueryClient() {
  const explicitSsl = process.env.DATABASE_SSL?.trim().toLowerCase();
  let useSsl: "require" | false;

  if (explicitSsl === "true" || explicitSsl === "require") {
    useSsl = "require";
  } else if (explicitSsl === "false" || explicitSsl === "disable") {
    useSsl = false;
  } else {
    // В production по умолчанию нужен SSL, но локальный Postgres обычно без SSL.
    try {
      const host = new URL(databaseUrlValue).hostname;
      const isLocalHost =
        host === "localhost" || host === "127.0.0.1" || host === "::1";
      useSsl = process.env.NODE_ENV === "production" && !isLocalHost ? "require" : false;
    } catch {
      useSsl = process.env.NODE_ENV === "production" ? "require" : false;
    }
  }

  return postgres(databaseUrlValue, {
    max: getPoolMax(),
    idle_timeout: 25,
    connect_timeout: 15,
    ssl: useSsl,
  });
}

globalForDb.__postgresClient ??= createQueryClient();
const queryClient = globalForDb.__postgresClient;

globalForDb.__drizzleDb ??= drizzle(queryClient, { schema });
export const db = globalForDb.__drizzleDb;