import "./config/load-env";
import { app } from "./api";
import {
  geminiEnabled,
  getGeminiConfig,
  resetGeminiQuotaCooldown,
} from "./moderation/ai/gemini-client";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "127.0.0.1";

resetGeminiQuotaCooldown();

app.listen({
  hostname: host,
  port,
});

console.log(`[elysia] API started on http://${host}:${port}`);

const gemini = getGeminiConfig();
if (geminiEnabled() && gemini) {
  console.log(`[gemini] configured model=${gemini.model} provider=${process.env.AI_PROVIDER ?? "auto"}`);
} else {
  console.warn("[gemini] GOOGLE_GEMINI_API_KEY не задан — только regex-модерация");
}