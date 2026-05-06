import { Elysia, t } from "elysia";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import { db } from "../db";
import {
  contentReports,
  conversationMembers,
  conversationPins,
  conversations,
  friendships,
  messages,
  posts,
  users,
} from "../db/schema";
import { applyModerationOrThrow, logModerationEvent } from "../moderation";

const MAX_MESSAGE_LEN = 8000;
const MAX_PINS_PER_CHAT = 30;
const DEFAULT_PAGE = 50;

const nullableString = t.Union([t.String(), t.Null()]);

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildDirectKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

function isDirectKeyUniqueError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("conversations_direct_key_unique") ||
    message.includes("duplicate key") ||
    message.includes("unique")
  );
}

async function areFriends(userA: string, userB: string) {
  const rows = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(
          and(
            eq(friendships.requesterId, userA),
            eq(friendships.addresseeId, userB)
          ),
          and(
            eq(friendships.requesterId, userB),
            eq(friendships.addresseeId, userA)
          )
        )
      )
    )
    .limit(1);
  return !!rows[0];
}

async function getConversationByDirectKey(directKey: string) {
  const rows = await db
    .select({
      id: conversations.id,
      directKey: conversations.directKey,
      updatedAt: conversations.updatedAt,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .where(eq(conversations.directKey, directKey))
    .limit(1);
  return rows[0] ?? null;
}

async function getAcceptedFriendIds(userId: string) {
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
          eq(friendships.requesterId, userId),
          eq(friendships.addresseeId, userId)
        )
      )
    );

  return rows.map((row) =>
    row.requesterId === userId ? row.addresseeId : row.requesterId
  );
}

async function ensureDirectConversation(userId: string, friendId: string) {
  if (userId === friendId) {
    throw new Error("Нельзя создать диалог с самим собой");
  }

  const friends = await areFriends(userId, friendId);
  if (!friends) {
    throw new Error("Личные сообщения доступны только друзьям");
  }

  const directKey = buildDirectKey(userId, friendId);
  let conversation = await getConversationByDirectKey(directKey);

  if (!conversation) {
    try {
      const inserted = await db
        .insert(conversations)
        .values({
          // Do not rely on DB default here: some local DBs miss default on id column.
          id: crypto.randomUUID(),
          type: "direct",
          directKey,
          updatedAt: new Date(),
          lastMessageAt: null,
        })
        .returning({
          id: conversations.id,
          directKey: conversations.directKey,
          updatedAt: conversations.updatedAt,
          lastMessageAt: conversations.lastMessageAt,
        });
      conversation = inserted[0] ?? null;
    } catch (error) {
      if (!isDirectKeyUniqueError(error)) {
        throw error;
      }
      conversation = await getConversationByDirectKey(directKey);
    }
  }

  if (!conversation) {
    throw new Error("Не удалось создать или найти диалог");
  }

  await db
    .insert(conversationMembers)
    .values([
      { conversationId: conversation.id, userId },
      { conversationId: conversation.id, userId: friendId },
    ])
    .onConflictDoNothing();

  return conversation;
}

async function ensureMembership(conversationId: string, userId: string) {
  const rows = await db
    .select({
      conversationId: conversationMembers.conversationId,
      userId: conversationMembers.userId,
      lastReadAt: conversationMembers.lastReadAt,
    })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Общая логика списка диалогов: Next.js API и Elysia */
export async function getConversationsListPayload(userId: string) {
  const friendIds = await getAcceptedFriendIds(userId);
  if (friendIds.length) {
    await Promise.all(
      friendIds.map(async (friendId) => {
        try {
          await ensureDirectConversation(userId, friendId);
        } catch {
          /* skip */
        }
      })
    );
  }

  const memberRows = await db
    .select({
      conversationId: conversationMembers.conversationId,
      lastReadAt: conversationMembers.lastReadAt,
    })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, userId));

  const conversationIds = memberRows.map((row) => row.conversationId);
  if (!conversationIds.length) {
    return { conversations: [] };
  }

  const convRows = await db
    .select({
      id: conversations.id,
      updatedAt: conversations.updatedAt,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .where(inArray(conversations.id, conversationIds))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.updatedAt));

  const allMembers = await db
    .select({
      conversationId: conversationMembers.conversationId,
      userId: conversationMembers.userId,
    })
    .from(conversationMembers)
    .where(inArray(conversationMembers.conversationId, conversationIds));

  const otherMemberIds = Array.from(
    new Set(
      allMembers
        .filter((member) => member.userId !== userId)
        .map((member) => member.userId)
    )
  );

  const userRows = otherMemberIds.length
    ? await db
        .select({
          id: users.id,
          username: users.username,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(inArray(users.id, otherMemberIds))
    : [];

  const messageRows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      type: messages.type,
      content: messages.content,
      sharedPostId: messages.sharedPostId,
      imageUrl: messages.imageUrl,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, conversationIds))
    .orderBy(desc(messages.createdAt));

  const lastMessageMap = new Map<string, (typeof messageRows)[number]>();
  for (const message of messageRows) {
    if (!lastMessageMap.has(message.conversationId)) {
      lastMessageMap.set(message.conversationId, message);
    }
  }

  const sharedPostIds = Array.from(
    new Set(
      messageRows
        .map((message) => message.sharedPostId)
        .filter((value): value is string => !!value)
    )
  );

  const sharedPosts = sharedPostIds.length
    ? await db
        .select({
          id: posts.id,
          slug: posts.slug,
          title: posts.title,
          coverImage: posts.coverImage,
        })
        .from(posts)
        .where(inArray(posts.id, sharedPostIds))
    : [];

  const userMap = new Map(userRows.map((user) => [user.id, user]));
  const sharedPostMap = new Map(sharedPosts.map((post) => [post.id, post]));

  return {
    conversations: convRows.map((conversation) => {
      const otherMember = allMembers.find(
        (member) =>
          member.conversationId === conversation.id && member.userId !== userId
      );
      const otherUser = otherMember ? userMap.get(otherMember.userId) ?? null : null;
      const lastMessage = lastMessageMap.get(conversation.id) ?? null;
      const currentMember = memberRows.find(
        (member) => member.conversationId === conversation.id
      );

      let previewText = "Пока нет сообщений";
      if (lastMessage) {
        if (lastMessage.type === "post_share") {
          previewText = `📎 ${sharedPostMap.get(lastMessage.sharedPostId!)?.title ?? "Пост"}`;
        } else if (lastMessage.type === "image") {
          previewText = "📷 Изображение";
        } else {
          previewText = lastMessage.content ?? "Сообщение";
        }
      }

      return {
        id: conversation.id,
        updatedAt:
          conversation.updatedAt?.toISOString?.() ?? conversation.updatedAt,
        lastMessageAt:
          conversation.lastMessageAt?.toISOString?.() ?? conversation.lastMessageAt,
        lastReadAt:
          currentMember?.lastReadAt?.toISOString?.() ?? currentMember?.lastReadAt ?? null,
        otherUser: otherUser
          ? {
              id: otherUser.id,
              username: otherUser.username,
              avatarUrl: otherUser.avatarUrl ?? null,
            }
          : null,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              senderId: lastMessage.senderId,
              type: lastMessage.type,
              content: lastMessage.content ?? null,
              imageUrl: lastMessage.imageUrl ?? null,
              createdAt:
                lastMessage.createdAt?.toISOString?.() ?? lastMessage.createdAt,
              sharedPost: lastMessage.sharedPostId
                ? sharedPostMap.get(lastMessage.sharedPostId) ?? null
                : null,
            }
          : null,
        previewText,
      };
    }),
  };
}

export const messagesRouter = new Elysia({ prefix: "/messages" })
  .get("/conversations/:userId", async ({ params, set }) => {
    try {
      return await getConversationsListPayload(params.userId);
    } catch (error: unknown) {
      console.error("GET /messages/conversations/:userId error:", error);
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

  .get("/direct/:userId/:friendId", async ({ params, set }) => {
    try {
      const conversation = await ensureDirectConversation(
        params.userId,
        params.friendId
      );
      return {
        conversation: {
          id: conversation.id,
          directKey: conversation.directKey,
          updatedAt:
            conversation.updatedAt?.toISOString?.() ?? conversation.updatedAt,
          lastMessageAt:
            conversation.lastMessageAt?.toISOString?.() ?? conversation.lastMessageAt,
        },
      };
    } catch (error: unknown) {
      console.error("GET /messages/direct/:userId/:friendId error:", error);
      const message = getErrorMessage(error);
      set.status = message.includes("друз") ? 403 : 500;
      return { error: message };
    }
  })

  .post(
    "/:conversationId/pin",
    async ({ params, body, set }) => {
      try {
        const membership = await ensureMembership(params.conversationId, body.userId);
        if (!membership) {
          set.status = 403;
          return { error: "Нет доступа к диалогу" };
        }
        const msgRow = await db.query.messages.findFirst({
          where: and(
            eq(messages.id, body.messageId),
            eq(messages.conversationId, params.conversationId)
          ),
          columns: { id: true },
        });
        if (!msgRow) {
          set.status = 404;
          return { error: "Сообщение не найдено в этом чате" };
        }
        const [{ n: pinCount }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(conversationPins)
          .where(eq(conversationPins.conversationId, params.conversationId));
        if (Number(pinCount) >= MAX_PINS_PER_CHAT) {
          set.status = 400;
          return { error: `Максимум ${MAX_PINS_PER_CHAT} закреплений в чате` };
        }
        await db
          .insert(conversationPins)
          .values({
            conversationId: params.conversationId,
            messageId: body.messageId,
            pinnedBy: body.userId,
          })
          .onConflictDoNothing({
            target: [conversationPins.conversationId, conversationPins.messageId],
          });
        return { success: true };
      } catch (error: unknown) {
        console.error("POST pin", error);
        set.status = 500;
        return { error: "Internal Server Error" };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
        messageId: t.String(),
      }),
    }
  )

  .delete(
    "/:conversationId/pin/:messageId",
    async ({ params, query, set }) => {
      try {
        const userId = String(query.userId ?? "");
        if (!userId) {
          set.status = 400;
          return { error: "userId обязателен" };
        }
        const membership = await ensureMembership(params.conversationId, userId);
        if (!membership) {
          set.status = 403;
          return { error: "Нет доступа к диалогу" };
        }
        await db
          .delete(conversationPins)
          .where(
            and(
              eq(conversationPins.conversationId, params.conversationId),
              eq(conversationPins.messageId, params.messageId)
            )
          );
        return { success: true };
      } catch (error: unknown) {
        console.error("DELETE pin", error);
        set.status = 500;
        return { error: "Internal Server Error" };
      }
    },
    {
      query: t.Object({
        userId: t.String(),
      }),
    }
  )

  .get(
    "/:conversationId",
    async ({ params, query, set }) => {
      try {
        const membership = await ensureMembership(
          params.conversationId,
          String(query.userId)
        );
        if (!membership) {
          set.status = 403;
          return { error: "Нет доступа к диалогу" };
        }

        const limitRaw = Number((query as { limit?: string }).limit ?? DEFAULT_PAGE);
        const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_PAGE));
        const beforeId = (query as { before?: string }).before?.trim() || null;
        const afterId = (query as { after?: string }).after?.trim() || null;

        const whereBase = eq(messages.conversationId, params.conversationId);

        type MsgRow = {
          id: string;
          conversationId: string;
          senderId: string;
          replyToId: string | null;
          type: string;
          content: string | null;
          sharedPostId: string | null;
          imageUrl: string | null;
          createdAt: Date;
          editedAt: Date | null;
        };

        let messageRows: MsgRow[] = [];
        let hasMore = false;

        if (afterId && !beforeId) {
          const anchor = await db.query.messages.findFirst({
            where: and(eq(messages.id, afterId), eq(messages.conversationId, params.conversationId)),
            columns: { createdAt: true, id: true },
          });
          if (anchor) {
            const newer = await db
              .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                replyToId: messages.replyToId,
                type: messages.type,
                content: messages.content,
                sharedPostId: messages.sharedPostId,
                imageUrl: messages.imageUrl,
                createdAt: messages.createdAt,
                editedAt: messages.editedAt,
              })
              .from(messages)
              .where(
                and(
                  whereBase,
                  or(
                    gt(messages.createdAt, anchor.createdAt),
                    and(eq(messages.createdAt, anchor.createdAt), gt(messages.id, anchor.id))
                  )
                )
              )
              .orderBy(asc(messages.createdAt), asc(messages.id))
              .limit(limit);
            messageRows = newer;
            hasMore = false;
          }
        }

        if (!messageRows.length) {
          let cursorAt: Date | null = null;
          if (beforeId) {
            const cur = await db.query.messages.findFirst({
              where: and(
                eq(messages.id, beforeId),
                eq(messages.conversationId, params.conversationId)
              ),
              columns: { createdAt: true },
            });
            cursorAt = cur?.createdAt ?? null;
          }

          const whereClause =
            cursorAt != null ? and(whereBase, lt(messages.createdAt, cursorAt)) : whereBase;

          const batch = await db
            .select({
              id: messages.id,
              conversationId: messages.conversationId,
              senderId: messages.senderId,
              replyToId: messages.replyToId,
              type: messages.type,
              content: messages.content,
              sharedPostId: messages.sharedPostId,
              imageUrl: messages.imageUrl,
              createdAt: messages.createdAt,
              editedAt: messages.editedAt,
            })
            .from(messages)
            .where(whereClause)
            .orderBy(desc(messages.createdAt))
            .limit(limit + 1);

          hasMore = batch.length > limit;
          const pageRows = hasMore ? batch.slice(0, limit) : batch;
          messageRows = [...pageRows].reverse();
        }

        const pinRows = await db
          .select({
            messageId: conversationPins.messageId,
            createdAt: conversationPins.createdAt,
          })
          .from(conversationPins)
          .where(eq(conversationPins.conversationId, params.conversationId))
          .orderBy(desc(conversationPins.createdAt));

        const senderIds = Array.from(new Set(messageRows.map((message) => message.senderId)));
        const senderRows = senderIds.length
          ? await db
              .select({
                id: users.id,
                username: users.username,
                avatarUrl: users.avatarUrl,
              })
              .from(users)
              .where(inArray(users.id, senderIds))
          : [];

        const sharedPostIds = Array.from(
          new Set(
            messageRows
              .map((message) => message.sharedPostId)
              .filter((value): value is string => !!value)
          )
        );
        const sharedPosts = sharedPostIds.length
          ? await db
              .select({
                id: posts.id,
                slug: posts.slug,
                title: posts.title,
                coverImage: posts.coverImage,
              })
              .from(posts)
              .where(inArray(posts.id, sharedPostIds))
          : [];

        const replyIds = Array.from(
          new Set(
            messageRows
              .map((m) => m.replyToId)
              .filter((v): v is string => !!v)
          )
        );
        const replyParents = replyIds.length
          ? await db
              .select({
                id: messages.id,
                senderId: messages.senderId,
                type: messages.type,
                content: messages.content,
                imageUrl: messages.imageUrl,
              })
              .from(messages)
              .where(inArray(messages.id, replyIds))
          : [];
        const replySenderIds = Array.from(new Set(replyParents.map((r) => r.senderId)));
        const replySenders = replySenderIds.length
          ? await db
              .select({
                id: users.id,
                username: users.username,
                avatarUrl: users.avatarUrl,
              })
              .from(users)
              .where(inArray(users.id, replySenderIds))
          : [];
        const replySenderMap = new Map(replySenders.map((s) => [s.id, s]));
        const replyMap = new Map(
          replyParents.map((r) => [
            r.id,
            {
              id: r.id,
              senderId: r.senderId,
              type: r.type,
              content: r.content ?? null,
              imageUrl: r.imageUrl ?? null,
              sender: replySenderMap.get(r.senderId) ?? null,
            },
          ])
        );

        const senderMap = new Map(senderRows.map((sender) => [sender.id, sender]));
        const sharedPostMap = new Map(sharedPosts.map((post) => [post.id, post]));

        const pinMsgIds = pinRows.map((p) => p.messageId);
        const pinMsgs = pinMsgIds.length
          ? await db
              .select({
                id: messages.id,
                type: messages.type,
                content: messages.content,
                imageUrl: messages.imageUrl,
                senderId: messages.senderId,
              })
              .from(messages)
              .where(inArray(messages.id, pinMsgIds))
          : [];
        const pinSenderIds = Array.from(new Set(pinMsgs.map((m) => m.senderId)));
        const pinSenders = pinSenderIds.length
          ? await db
              .select({
                id: users.id,
                username: users.username,
                avatarUrl: users.avatarUrl,
              })
              .from(users)
              .where(inArray(users.id, pinSenderIds))
          : [];
        const pinSenderMap = new Map(pinSenders.map((s) => [s.id, s]));
        const pinMsgMap = new Map(pinMsgs.map((m) => [m.id, m]));
        const pinsOut = pinRows.map((pin) => {
          const m = pinMsgMap.get(pin.messageId) ?? null;
          const snd = m ? pinSenderMap.get(m.senderId) ?? null : null;
          return {
            messageId: pin.messageId,
            createdAt: pin.createdAt?.toISOString?.() ?? pin.createdAt,
            preview: m
              ? {
                  type: m.type,
                  text:
                    m.type === "image"
                      ? "Фотография"
                      : m.type === "post_share"
                        ? "Пост"
                        : (m.content ?? "").slice(0, 140) || "Сообщение",
                  imageUrl: m.imageUrl ?? null,
                  sender: snd
                    ? { username: snd.username, avatarUrl: snd.avatarUrl ?? null }
                    : null,
                }
              : null,
          };
        });

        return {
          messages: messageRows.map((message) => ({
            id: message.id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            replyToId: message.replyToId ?? null,
            replyTo: message.replyToId
              ? (replyMap.get(message.replyToId) ?? null)
              : null,
            type: message.type,
            content: message.content ?? null,
            imageUrl: message.imageUrl ?? null,
            createdAt: message.createdAt?.toISOString?.() ?? message.createdAt,
            editedAt: message.editedAt?.toISOString?.() ?? message.editedAt,
            sender: senderMap.get(message.senderId) ?? null,
            sharedPost: message.sharedPostId
              ? sharedPostMap.get(message.sharedPostId) ?? null
              : null,
          })),
          pins: pinsOut,
          hasMore,
        };
      } catch (error: unknown) {
        console.error("GET /messages/:conversationId error:", error);
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
      query: t.Object({
        userId: t.String(),
        limit: t.Optional(t.String()),
        before: t.Optional(t.String()),
        after: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/send",
    async ({ body, set }) => {
      try {
        let content = body.content ? String(body.content).trim() : "";
        if (content.length > MAX_MESSAGE_LEN) {
          content = content.slice(0, MAX_MESSAGE_LEN);
        }
        const sharedPostId = body.sharedPostId ?? null;
        const imageUrl = body.imageUrl ?? null;
        const replyToId = body.replyToId?.trim() || null;

        // Проверка: должно быть хотя бы что-то
        if (!content && !sharedPostId && !imageUrl) {
          set.status = 400;
          return { error: "Нужно текстовое сообщение, изображение или sharedPostId" };
        }

        let conversationId = body.conversationId ?? null;
        if (!conversationId) {
          if (!body.targetUserId) {
            set.status = 400;
            return { error: "Нужен conversationId или targetUserId" };
          }
          const conversation = await ensureDirectConversation(
            body.userId,
            body.targetUserId
          );
          conversationId = conversation.id;
        }

        const membership = await ensureMembership(conversationId, body.userId);
        if (!membership) {
          set.status = 403;
          return { error: "Нет доступа к диалогу" };
        }

        if (sharedPostId) {
          const postRows = await db
            .select({ id: posts.id })
            .from(posts)
            .where(eq(posts.id, sharedPostId))
            .limit(1);
          if (!postRows[0]) {
            set.status = 404;
            return { error: "Пост не найден" };
          }
        }

        if (replyToId) {
          const parent = await db.query.messages.findFirst({
            where: and(
              eq(messages.id, replyToId),
              eq(messages.conversationId, conversationId)
            ),
            columns: { id: true },
          });
          if (!parent) {
            set.status = 400;
            return { error: "Ответ на несуществующее сообщение в этом чате" };
          }
        }

        // Определяем тип сообщения
        let messageType: "text" | "post_share" | "image" = "text";
        if (sharedPostId) messageType = "post_share";
        else if (imageUrl) messageType = "image";

        const now = new Date();
        const messageId = crypto.randomUUID();

        let cleanContent: string | null = content || null;
        let wasCensored = false;
        let matchedCount = 0;
        if (messageType === "text" && content) {
          try {
            const m = await applyModerationOrThrow({
              userId: body.userId,
              targetType: "message",
              targetId: null,
              scope: "messages",
              text: content,
            });
            cleanContent = m.cleanText || null;
            wasCensored = m.result.censored;
            matchedCount = m.result.matchedCount;
          } catch (e) {
            set.status = 400;
            return { error: e instanceof Error ? e.message : "Сообщение не прошло модерацию" };
          }
        }

        const inserted = await db
          .insert(messages)
          .values({
            id: messageId,
            conversationId,
            senderId: body.userId,
            replyToId: replyToId ?? null,
            type: messageType,
            content: cleanContent,
            sharedPostId,
            imageUrl,
          })
          .returning({
            id: messages.id,
            conversationId: messages.conversationId,
            senderId: messages.senderId,
            replyToId: messages.replyToId,
            type: messages.type,
            content: messages.content,
            sharedPostId: messages.sharedPostId,
            imageUrl: messages.imageUrl,
            createdAt: messages.createdAt,
            editedAt: messages.editedAt,
          });

        await db
          .update(conversations)
          .set({
            updatedAt: now,
            lastMessageAt: now,
          })
          .where(eq(conversations.id, conversationId));

        if (wasCensored) {
          await logModerationEvent({
            userId: body.userId,
            targetType: "message",
            targetId: messageId,
            action: "censor",
            scope: "messages",
            matchedCount,
          });
        }

        return {
          success: true,
          conversationId,
          message: {
            ...inserted[0],
            createdAt:
              inserted[0].createdAt?.toISOString?.() ?? inserted[0].createdAt,
            editedAt:
              inserted[0].editedAt?.toISOString?.() ?? inserted[0].editedAt,
          },
        };
      } catch (error: unknown) {
        console.error("POST /messages/send error:", error);
        const message = getErrorMessage(error);
        set.status = message.includes("друз") ? 403 : 500;
        return { error: message };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
        conversationId: t.Optional(t.String()),
        targetUserId: t.Optional(t.String()),
        content: t.Optional(nullableString),
        sharedPostId: t.Optional(nullableString),
        imageUrl: t.Optional(t.String()),
        replyToId: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/read",
    async ({ body, set }) => {
      try {
        const membership = await ensureMembership(body.conversationId, body.userId);
        if (!membership) {
          set.status = 403;
          return { error: "Нет доступа к диалогу" };
        }

        await db
          .update(conversationMembers)
          .set({ lastReadAt: new Date() })
          .where(
            and(
              eq(conversationMembers.conversationId, body.conversationId),
              eq(conversationMembers.userId, body.userId)
            )
          );

        return { success: true };
      } catch (error: unknown) {
        console.error("POST /messages/read error:", error);
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
        conversationId: t.String(),
      }),
    }
  )

  .post(
    "/report",
    async ({ body, set }) => {
      try {
        const membership = await ensureMembership(body.conversationId, body.userId);
        if (!membership) {
          set.status = 403;
          return { error: "Нет доступа к диалогу" };
        }
        const msg = await db.query.messages.findFirst({
          where: and(
            eq(messages.id, body.messageId),
            eq(messages.conversationId, body.conversationId)
          ),
          columns: { id: true },
        });
        if (!msg) {
          set.status = 404;
          return { error: "Сообщение не найдено" };
        }
        await db.insert(contentReports).values({
          reporterId: body.userId,
          targetType: "message",
          targetId: body.messageId,
          reason: body.reason?.trim() || null,
        });
        return { success: true };
      } catch (error: unknown) {
        console.error("POST /messages/report error:", error);
        set.status = 500;
        return { error: "Internal Server Error" };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
        conversationId: t.String(),
        messageId: t.String(),
        reason: t.Optional(t.String()),
      }),
    }
  );