import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import { db } from "@/server/db";
import {
  contentReports,
  conversationMembers,
  conversationPins,
  conversations,
  friendships,
  messages,
  posts,
  users,
} from "@/server/db/schema";

const MAX_MESSAGE_LEN = 8000;
const MAX_PINS_PER_CHAT = 30;
const DEFAULT_PAGE = 50;

function buildDirectKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

async function areFriends(userA: string, userB: string) {
  const rows = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(
          and(eq(friendships.requesterId, userA), eq(friendships.addresseeId, userB)),
          and(eq(friendships.requesterId, userB), eq(friendships.addresseeId, userA))
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

export async function ensureDirectConversation(userId: string, friendId: string) {
  if (userId === friendId) throw new Error("Нельзя создать диалог с самим собой");
  if (!(await areFriends(userId, friendId))) {
    throw new Error("Личные сообщения доступны только друзьям");
  }

  const directKey = buildDirectKey(userId, friendId);
  let conversation = await getConversationByDirectKey(directKey);

  if (!conversation) {
    try {
      const inserted = await db
        .insert(conversations)
        .values({
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
    } catch {
      conversation = await getConversationByDirectKey(directKey);
    }
  }

  if (!conversation) throw new Error("Не удалось создать или найти диалог");

  await db
    .insert(conversationMembers)
    .values([
      { conversationId: conversation.id, userId },
      { conversationId: conversation.id, userId: friendId },
    ])
    .onConflictDoNothing();

  return conversation;
}

export async function ensureMembership(conversationId: string, userId: string) {
  const rows = await db
    .select({
      conversationId: conversationMembers.conversationId,
      userId: conversationMembers.userId,
      lastReadAt: conversationMembers.lastReadAt,
    })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getConversationMessagesPayload(
  conversationId: string,
  userId: string,
  opts?: { limit?: number; before?: string | null; after?: string | null }
) {
  const membership = await ensureMembership(conversationId, userId);
  if (!membership) throw new Error("Нет доступа к диалогу");

  const limit = Math.min(100, Math.max(1, opts?.limit ?? DEFAULT_PAGE));
  const beforeId = opts?.before?.trim() || null;
  const afterId = opts?.after?.trim() || null;
  const whereBase = eq(messages.conversationId, conversationId);

  let messageRows: any[] = [];
  let hasMore = false;

  if (afterId && !beforeId) {
    const anchor = await db.query.messages.findFirst({
      where: and(eq(messages.id, afterId), eq(messages.conversationId, conversationId)),
      columns: { createdAt: true, id: true },
    });
    if (anchor) {
      messageRows = await db
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
    }
  }

  if (!messageRows.length) {
    let cursorAt: Date | null = null;
    if (beforeId) {
      const cur = await db.query.messages.findFirst({
        where: and(eq(messages.id, beforeId), eq(messages.conversationId, conversationId)),
        columns: { createdAt: true },
      });
      cursorAt = cur?.createdAt ?? null;
    }
    const whereClause = cursorAt ? and(whereBase, lt(messages.createdAt, cursorAt)) : whereBase;
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
    messageRows = [...(hasMore ? batch.slice(0, limit) : batch)].reverse();
  }

  const senderIds = Array.from(new Set(messageRows.map((m) => m.senderId)));
  const senderRows = senderIds.length
    ? await db.select({ id: users.id, username: users.username, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, senderIds))
    : [];
  const senderMap = new Map(senderRows.map((s) => [s.id, s]));

  const pinRows = await db
    .select({ messageId: conversationPins.messageId, createdAt: conversationPins.createdAt })
    .from(conversationPins)
    .where(eq(conversationPins.conversationId, conversationId))
    .orderBy(desc(conversationPins.createdAt));

  const pinMsgIds = pinRows.map((p) => p.messageId);
  const pinMsgs = pinMsgIds.length
    ? await db.select({ id: messages.id, type: messages.type, content: messages.content, imageUrl: messages.imageUrl, senderId: messages.senderId }).from(messages).where(inArray(messages.id, pinMsgIds))
    : [];
  const pinMsgMap = new Map(pinMsgs.map((m) => [m.id, m]));

  return {
    messages: messageRows.map((m) => ({
      ...m,
      content: m.content ?? null,
      imageUrl: m.imageUrl ?? null,
      createdAt: m.createdAt?.toISOString?.() ?? m.createdAt,
      editedAt: m.editedAt?.toISOString?.() ?? m.editedAt,
      sender: senderMap.get(m.senderId) ?? null,
      sharedPost: null,
      replyTo: null,
    })),
    pins: pinRows.map((pin) => {
      const m = pinMsgMap.get(pin.messageId);
      return {
        messageId: pin.messageId,
        createdAt: pin.createdAt?.toISOString?.() ?? pin.createdAt,
        preview: m
          ? {
              type: m.type,
              text: m.type === "image" ? "Фотография" : (m.content ?? "").slice(0, 140) || "Сообщение",
              imageUrl: m.imageUrl ?? null,
              sender: null,
            }
          : null,
      };
    }),
    hasMore,
  };
}

export async function sendMessagePayload(params: {
  userId: string;
  conversationId?: string | null;
  targetUserId?: string | null;
  content?: string | null;
  sharedPostId?: string | null;
  imageUrl?: string | null;
  replyToId?: string | null;
}) {
  let content = params.content ? String(params.content).trim() : "";
  if (content.length > MAX_MESSAGE_LEN) content = content.slice(0, MAX_MESSAGE_LEN);

  const sharedPostId = params.sharedPostId ?? null;
  const imageUrl = params.imageUrl ?? null;
  const replyToId = params.replyToId?.trim() || null;
  if (!content && !sharedPostId && !imageUrl) {
    throw new Error("Нужно текстовое сообщение, изображение или sharedPostId");
  }

  let conversationId = params.conversationId ?? null;
  if (!conversationId) {
    if (!params.targetUserId) throw new Error("Нужен conversationId или targetUserId");
    const conv = await ensureDirectConversation(params.userId, params.targetUserId);
    conversationId = conv.id;
  }
  if (!(await ensureMembership(conversationId, params.userId))) throw new Error("Нет доступа к диалогу");

  const now = new Date();
  const inserted = await db
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      conversationId,
      senderId: params.userId,
      replyToId: replyToId ?? null,
      type: sharedPostId ? "post_share" : imageUrl ? "image" : "text",
      content: content || null,
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

  await db.update(conversations).set({ updatedAt: now, lastMessageAt: now }).where(eq(conversations.id, conversationId));

  return {
    success: true,
    conversationId,
    message: {
      ...inserted[0],
      createdAt: inserted[0].createdAt?.toISOString?.() ?? inserted[0].createdAt,
      editedAt: inserted[0].editedAt?.toISOString?.() ?? inserted[0].editedAt,
    },
  };
}

export async function markConversationRead(conversationId: string, userId: string) {
  if (!(await ensureMembership(conversationId, userId))) throw new Error("Нет доступа к диалогу");
  await db
    .update(conversationMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  return { success: true };
}

export async function pinMessage(conversationId: string, messageId: string, userId: string) {
  if (!(await ensureMembership(conversationId, userId))) throw new Error("Нет доступа к диалогу");
  const msgRow = await db.query.messages.findFirst({
    where: and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)),
    columns: { id: true },
  });
  if (!msgRow) throw new Error("Сообщение не найдено в этом чате");

  const [{ n: pinCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversationPins)
    .where(eq(conversationPins.conversationId, conversationId));
  if (Number(pinCount) >= MAX_PINS_PER_CHAT) throw new Error(`Максимум ${MAX_PINS_PER_CHAT} закреплений в чате`);

  await db
    .insert(conversationPins)
    .values({ conversationId, messageId, pinnedBy: userId })
    .onConflictDoNothing({ target: [conversationPins.conversationId, conversationPins.messageId] });
  return { success: true };
}

export async function unpinMessage(conversationId: string, messageId: string, userId: string) {
  if (!(await ensureMembership(conversationId, userId))) throw new Error("Нет доступа к диалогу");
  await db.delete(conversationPins).where(and(eq(conversationPins.conversationId, conversationId), eq(conversationPins.messageId, messageId)));
  return { success: true };
}

export async function reportMessage(conversationId: string, messageId: string, userId: string, reason?: string) {
  if (!(await ensureMembership(conversationId, userId))) throw new Error("Нет доступа к диалогу");
  const msg = await db.query.messages.findFirst({
    where: and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)),
    columns: { id: true },
  });
  if (!msg) throw new Error("Сообщение не найдено");
  await db.insert(contentReports).values({
    reporterId: userId,
    targetType: "message",
    targetId: messageId,
    reason: reason?.trim() || null,
  });
  return { success: true };
}

