import { app } from "./api";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "127.0.0.1";

app.listen({
  hostname: host,
  port,
});

console.log(`[elysia] API started on http://${host}:${port}`);