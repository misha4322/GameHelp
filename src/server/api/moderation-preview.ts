import { Elysia, t } from "elysia";

import type { ModerationScope } from "../../lib/moderation/moderate-text";
import { handleModerationPreview } from "../moderation/preview-handler";

const scopeSchema = t.Union([
  t.Literal("all"),
  t.Literal("posts"),
  t.Literal("comments"),
  t.Literal("messages"),
  t.Literal("profile"),
]);

export const moderationPreviewRouter = new Elysia({ prefix: "/moderation" }).post(
  "/preview",
  async ({ body, set }) => {
    const text = String(body.text ?? "").trim();
    const scope = body.scope as ModerationScope;
    const sourceField =
      typeof body.sourceField === "string" && body.sourceField.trim()
        ? body.sourceField.trim()
        : undefined;

    if (!text) {
      set.status = 400;
      return { error: "Пустой текст" };
    }

    const result = await handleModerationPreview({
      text,
      scope,
      sourceField,
      skipAi: body.skipAi === true,
    });
    set.status = result.status;
    return result.body;
  },
  {
    body: t.Object({
      text: t.String(),
      scope: scopeSchema,
      sourceField: t.Optional(t.String()),
      userId: t.Optional(t.String()),
      skipAi: t.Optional(t.Boolean()),
    }),
  }
);

export const moderationGeminiPingRouter = new Elysia({ prefix: "/moderation" }).get(
  "/gemini-ping",
  async () => {
    const { geminiPing } = await import("../moderation/ai/gemini-client");
    return geminiPing();
  }
);
