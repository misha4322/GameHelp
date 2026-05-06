import { Elysia, t } from "elysia";
import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "../db";
import { conversationMembers, conversations, friendships, users } from "../db/schema";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function findTargetById(targetId: string) {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);

  return rows[0] ?? null;
}

function buildDirectKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

async function ensureDirectConversationForFriends(userA: string, userB: string) {
  const directKey = buildDirectKey(userA, userB);

  let conversation = await db.query.conversations.findFirst({
    where: eq(conversations.directKey, directKey),
    columns: { id: true },
  });

  if (!conversation) {
    const inserted = await db
      .insert(conversations)
      .values({
        id: crypto.randomUUID(),
        type: "direct",
        directKey,
        updatedAt: new Date(),
        lastMessageAt: null,
      })
      .onConflictDoNothing()
      .returning({ id: conversations.id });

    conversation =
      inserted[0] ??
      (await db.query.conversations.findFirst({
        where: eq(conversations.directKey, directKey),
        columns: { id: true },
      })) ??
      null;
  }

  if (!conversation) return;

  await db
    .insert(conversationMembers)
    .values([
      { conversationId: conversation.id, userId: userA },
      { conversationId: conversation.id, userId: userB },
    ])
    .onConflictDoNothing();
}

export const friendsRouter = new Elysia({ prefix: "/friends" })
  .post(
    "/request",
    async ({ body, set }) => {
      try {
        const userId = body.userId;
        const target = await findTargetById(body.targetId);

        if (!target) {
          set.status = 404;
          return { error: "Пользователь не найден" };
        }

        if (userId === target.id) {
          set.status = 400;
          return { error: "Нельзя добавить себя" };
        }

        const acceptedRows = await db
          .select({ id: friendships.id })
          .from(friendships)
          .where(
            and(
              eq(friendships.status, "accepted"),
              or(
                and(
                  eq(friendships.requesterId, userId),
                  eq(friendships.addresseeId, target.id)
                ),
                and(
                  eq(friendships.requesterId, target.id),
                  eq(friendships.addresseeId, userId)
                )
              )
            )
          )
          .limit(1);

        if (acceptedRows[0]) {
          return { success: true, status: "accepted", target };
        }

        const incomingRows = await db
          .select({ id: friendships.id })
          .from(friendships)
          .where(
            and(
              eq(friendships.requesterId, target.id),
              eq(friendships.addresseeId, userId),
              eq(friendships.status, "pending")
            )
          )
          .limit(1);

        if (incomingRows[0]) {
          await db
            .update(friendships)
            .set({ status: "accepted", updatedAt: new Date() })
            .where(eq(friendships.id, incomingRows[0].id));

          await ensureDirectConversationForFriends(userId, target.id);

          return {
            success: true,
            status: "accepted",
            message: "Заявка найдена и автоматически принята ✅",
            target,
          };
        }

        const outgoingRows = await db
          .select({ id: friendships.id })
          .from(friendships)
          .where(
            and(
              eq(friendships.requesterId, userId),
              eq(friendships.addresseeId, target.id),
              eq(friendships.status, "pending")
            )
          )
          .limit(1);

        if (outgoingRows[0]) {
          await db
            .update(friendships)
            .set({ status: "accepted", updatedAt: new Date() })
            .where(eq(friendships.id, outgoingRows[0].id));

          await ensureDirectConversationForFriends(userId, target.id);

          return {
            success: true,
            status: "accepted",
            message: "Дружба автоматически подтверждена ✅",
            target,
          };
        }

        await db.insert(friendships).values({
          requesterId: userId,
          addresseeId: target.id,
          status: "accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await ensureDirectConversationForFriends(userId, target.id);

        return {
          success: true,
          status: "accepted",
          message: "Пользователь добавлен в друзья ✅",
          target,
        };
      } catch (error: unknown) {
        console.error("POST /friends/request error:", error);
        set.status = 500;

        return {
          error: "Internal Server Error",
          details:
            process.env.NODE_ENV === "development"
              ? getErrorMessage(error)
              : undefined,
        };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
        targetId: t.String(),
      }),
    }
  )

  .post(
    "/accept",
    async ({ body, set }) => {
      try {
        const rows = await db
          .select({ id: friendships.id })
          .from(friendships)
          .where(
            and(
              eq(friendships.requesterId, body.requesterId),
              eq(friendships.addresseeId, body.userId),
              eq(friendships.status, "pending")
            )
          )
          .limit(1);

        const row = rows[0];

        if (!row) {
          set.status = 404;
          return { error: "Заявка не найдена" };
        }

        await db
          .update(friendships)
          .set({ status: "accepted", updatedAt: new Date() })
          .where(eq(friendships.id, row.id));

        await ensureDirectConversationForFriends(body.userId, body.requesterId);

        return { success: true, status: "accepted" };
      } catch (error: unknown) {
        console.error("POST /friends/accept error:", error);
        set.status = 500;

        return {
          error: "Internal Server Error",
          details:
            process.env.NODE_ENV === "development"
              ? getErrorMessage(error)
              : undefined,
        };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
        requesterId: t.String(),
      }),
    }
  )

  .post(
    "/remove",
    async ({ body, set }) => {
      try {
        await db.delete(friendships).where(
          or(
            and(
              eq(friendships.requesterId, body.userId),
              eq(friendships.addresseeId, body.targetId)
            ),
            and(
              eq(friendships.requesterId, body.targetId),
              eq(friendships.addresseeId, body.userId)
            )
          )
        );

        return { success: true };
      } catch (error: unknown) {
        console.error("POST /friends/remove error:", error);
        set.status = 500;

        return {
          error: "Internal Server Error",
          details:
            process.env.NODE_ENV === "development"
              ? getErrorMessage(error)
              : undefined,
        };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
        targetId: t.String(),
      }),
    }
  )

  .get("/requests/:userId", async ({ params, set }) => {
    try {
      const rows = await db
        .select({
          requesterId: friendships.requesterId,
          createdAt: friendships.createdAt,
        })
        .from(friendships)
        .where(
          and(
            eq(friendships.addresseeId, params.userId),
            eq(friendships.status, "pending")
          )
        );

      const ids = rows.map((row) => row.requesterId);

      if (!ids.length) {
        return { requests: [] };
      }

      const requestUsers = await db
        .select({
          id: users.id,
          username: users.username,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(inArray(users.id, ids));

      return {
        requests: rows
          .map((row) => ({
            from: requestUsers.find((user) => user.id === row.requesterId) ?? null,
            createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
          }))
          .filter((row) => row.from !== null),
      };
    } catch (error: unknown) {
      console.error("GET /friends/requests/:userId error:", error);
      set.status = 500;

      return {
        error: "Internal Server Error",
        details:
          process.env.NODE_ENV === "development"
            ? getErrorMessage(error)
            : undefined,
      };
    }
  })

  .get("/list/:userId", async ({ params, set }) => {
    try {
      const rows = await db
        .select({
          requesterId: friendships.requesterId,
          addresseeId: friendships.addresseeId,
        })
        .from(friendships)
        .where(
          and(
            eq(friendships.status, "accepted"),
            or(
              eq(friendships.requesterId, params.userId),
              eq(friendships.addresseeId, params.userId)
            )
          )
        );

      const friendIds = rows.map((row) =>
        row.requesterId === params.userId ? row.addresseeId : row.requesterId
      );

      if (!friendIds.length) {
        return { friends: [] };
      }

      const list = await db
        .select({
          id: users.id,
          username: users.username,
          avatarUrl: users.avatarUrl,
          isProfilePrivate: users.isProfilePrivate,
        })
        .from(users)
        .where(inArray(users.id, friendIds));

      return { friends: list };
    } catch (error: unknown) {
      console.error("GET /friends/list/:userId error:", error);
      set.status = 500;

      return {
        error: "Internal Server Error",
        details:
          process.env.NODE_ENV === "development"
            ? getErrorMessage(error)
            : undefined,
      };
    }
  });