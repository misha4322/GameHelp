import { Elysia } from "elysia";
import { node } from "@elysiajs/node";

import { postsRouter } from "./posts";
import { commentsRouter } from "./comments";
import { likesRouter } from "./likesRouter";
import { forumRouter } from "./forum";
import { authRouter } from "./auth";
import { friendsRouter } from "./friends";
import { usersRouter } from "./users";
import { messagesRouter } from "./messages";
import { recommendationsRouter } from "./recommendations";
import { moderationWordsRouter } from "./moderation-words";

const allowedOrigins = new Set<string>([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

for (const raw of (process.env.ALLOWED_CORS_ORIGINS ?? "").split(",")) {
  const o = raw.trim();
  if (o) allowedOrigins.add(o);
}

/** Те же хосты, что в next.config allowedDevOrigins (туннели CloudPub и т.д.) */
for (const raw of (process.env.ALLOWED_DEV_ORIGINS ?? "").split(",")) {
  const entry = raw.trim();
  if (!entry) continue;
  if (entry.includes("://")) {
    try {
      allowedOrigins.add(new URL(entry).origin);
    } catch {
      /* ignore */
    }
    continue;
  }
  const isLocal =
    entry === "localhost" ||
    entry.startsWith("localhost:") ||
    entry.startsWith("127.0.0.1");
  allowedOrigins.add(isLocal ? `http://${entry}` : `https://${entry}`);
}

if (process.env.NEXTAUTH_URL) {
  try {
    allowedOrigins.add(new URL(process.env.NEXTAUTH_URL).origin);
  } catch {
    /* ignore */
  }
}

function applyCors(request: Request, set: any) {
  const origin = request.headers.get("origin");

  if (!origin || !allowedOrigins.has(origin)) {
    return;
  }

  set.headers["Access-Control-Allow-Origin"] = origin;
  set.headers["Access-Control-Allow-Methods"] =
    "GET, POST, PUT, PATCH, DELETE, OPTIONS";
  set.headers["Access-Control-Allow-Headers"] =
    "Content-Type, Authorization";
  set.headers["Access-Control-Allow-Credentials"] = "true";
  set.headers["Vary"] = "Origin";
}

export const app = new Elysia({
  adapter: node(),
  prefix: "/api",
})
  .onRequest(({ request, set }) => {
    applyCors(request, set);
  })
  .onAfterHandle(({ request, set }) => {
    applyCors(request, set);
  })
  .options("/*", ({ request, set }) => {
    applyCors(request, set);
    set.status = 204;
    return "";
  })
  .get("/health", () => ({
    ok: true,
    service: "elysia-api",
  }))
  .use(authRouter)
  .use(postsRouter)
  .use(commentsRouter)
  .use(likesRouter)
  .use(forumRouter)
  .use(usersRouter)
  .use(friendsRouter)
  .use(messagesRouter)
  .use(recommendationsRouter)
  .use(moderationWordsRouter);

export type App = typeof app;