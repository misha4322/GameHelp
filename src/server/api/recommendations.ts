import { Elysia, t } from "elysia";

import {
  HOME_FOR_YOU_DEFAULT_LIMIT,
  RECOMMENDATIONS_API_MAX_LIMIT,
} from "@/lib/recommendations-display";
import { getRecommendationsHome } from "../services/recommendations";

export const recommendationsRouter = new Elysia({ prefix: "/recommendations" })
  .get(
    "/home",
    async ({ query }) => {
      const raw = Number(query.limit ?? HOME_FOR_YOU_DEFAULT_LIMIT);
      const limit = Math.max(
        3,
        Math.min(RECOMMENDATIONS_API_MAX_LIMIT, Number.isFinite(raw) ? raw : HOME_FOR_YOU_DEFAULT_LIMIT)
      );
      const viewerId = query.viewerId?.trim() || null;
      return getRecommendationsHome(viewerId, limit);
    },
    {
      query: t.Object({
        viewerId: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
      }),
    }
  )
  .post(
    "/event",
    async ({ body }) => {
      return {
        success: true,
        loggedAt: new Date().toISOString(),
        event: {
          viewerId: body.viewerId ?? null,
          postId: body.postId,
          block: body.block,
          eventType: body.eventType,
        },
      };
    },
    {
      body: t.Object({
        viewerId: t.Optional(t.String()),
        postId: t.String(),
        block: t.Union([
          t.Literal("forYou"),
          t.Literal("fromFriends"),
          t.Literal("trending"),
          t.Literal("newInFavoriteTags"),
        ]),
        eventType: t.Union([t.Literal("impression"), t.Literal("click")]),
      }),
    }
  );
