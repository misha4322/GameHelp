"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import SimpleBar from "simplebar-react";
import "simplebar-react/dist/simplebar.min.css";

import { apiRequest } from "@/lib/api";
import styles from "./MessagesClient.module.css";

const MESSAGE_PAGE = 40;

type ReplyPreview = {
  id: string;
  senderId: string;
  type: string;
  content: string | null;
  imageUrl: string | null;
  sender: { username?: string; avatarUrl?: string | null } | null;
};

type PinRow = {
  messageId: string;
  createdAt: string;
  preview: {
    type: string;
    text: string;
    imageUrl: string | null;
    sender: { username?: string; avatarUrl?: string | null } | null;
  } | null;
};

function replySnippet(reply: ReplyPreview | null | undefined): string {
  if (!reply) return "";
  if (reply.type === "image") return "Фотография";
  if (reply.type === "post_share") return "Пост";
  const t = (reply.content ?? "").trim();
  return t ? t.slice(0, 140) : "Сообщение";
}

/** Убираем хвост вида «англ (кириллица)» — в чате показываем коротко. */
function shortSenderLabel(username: string | undefined | null): string {
  const u = (username ?? "").trim();
  if (!u) return "Пользователь";
  const paren = u.indexOf(" (");
  if (paren > 0) return u.slice(0, paren).trim() || u;
  return u;
}

function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatDaySeparatorLabel(date: Date): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msgDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((todayStart - msgDayStart) / 86400000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

type TimelineEntry =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; msg: any };

function buildMessageTimeline(messages: any[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let prevDayKey = "";
  for (const msg of messages) {
    const d = msg.createdAt ? new Date(msg.createdAt) : new Date();
    const dk = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (dk !== prevDayKey) {
      prevDayKey = dk;
      out.push({
        kind: "day",
        key: `day-${dk}-${msg.id}`,
        label: formatDaySeparatorLabel(d),
      });
    }
    out.push({ kind: "msg", msg });
  }
  return out;
}

/** Слияние по id: не теряем сообщения при одинаковом createdAt и при частичных ответах поллинга. */
function mergeMessageListsById(prev: any[], incoming: any[]): any[] {
  if (!incoming.length) return prev;
  const byId = new Map<string, any>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

function buildMessageFromSendResult(
  row: {
    id: string;
    conversationId: string;
    senderId: string;
    replyToId: string | null;
    type: string;
    content: string | null;
    sharedPostId: string | null;
    imageUrl: string | null;
    createdAt: string;
    editedAt?: string | null;
  },
  viewer: { username: string; avatarUrl: string | null },
  replyTo: ReplyPreview | null,
  shareMeta: { shareTitle: string | null; sharePostSlug: string | null }
): Record<string, unknown> {
  const sharedPost =
    row.sharedPostId && row.type === "post_share"
      ? {
          id: row.sharedPostId,
          slug: shareMeta.sharePostSlug ?? "",
          title: shareMeta.shareTitle ?? "Пост",
          coverImage: null as string | null,
        }
      : null;

  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    replyToId: row.replyToId ?? null,
    replyTo:
      row.replyToId && replyTo && replyTo.id === row.replyToId ? replyTo : null,
    type: row.type,
    content: row.content ?? null,
    imageUrl: row.imageUrl ?? null,
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
    sender: { username: viewer.username, avatarUrl: viewer.avatarUrl },
    sharedPost,
  };
}

export default function MessagesClient({
  userId,
  viewerUsername = "Вы",
  viewerAvatarUrl = null,
}: {
  userId: string;
  viewerUsername?: string;
  viewerAvatarUrl?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [pins, setPins] = useState<PinRow[]>([]);
  const [pinIndex, setPinIndex] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pendingReply, setPendingReply] = useState<{
    id: string;
    replyTo: ReplyPreview;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    msg: any;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollPreserve = useRef<{ height: number; top: number } | null>(null);
  const pollSkipRef = useRef(false);
  const messagesEndIdRef = useRef<string | null>(null);
  const pollInFlightRef = useRef(false);
  const scrollToBottomAfterMessagesRef = useRef(false);
  const peerLongPressTimerRef = useRef<number | null>(null);
  const peerLongPressDidNavigateRef = useRef(false);

  const withUserId = searchParams.get("with");
  const sharePostId = searchParams.get("sharePostId");
  const sharePostSlug = searchParams.get("sharePostSlug");
  const shareTitle = searchParams.get("shareTitle");

  const currentConversation = useMemo(
    () => conversations.find((c: any) => c.id === currentConversationId) ?? null,
    [conversations, currentConversationId]
  );

  const peerProfileId = currentConversation?.otherUser?.id ?? null;
  const peerUsername = currentConversation?.otherUser?.username ?? "Диалог";

  const clearPeerLongPressTimer = useCallback(() => {
    if (peerLongPressTimerRef.current != null) {
      window.clearTimeout(peerLongPressTimerRef.current);
      peerLongPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPeerLongPressTimer(), [clearPeerLongPressTimer]);

  const onChatPeerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      peerLongPressDidNavigateRef.current = false;
      clearPeerLongPressTimer();
      if (!peerProfileId || e.pointerType !== "touch") return;
      peerLongPressTimerRef.current = window.setTimeout(() => {
        peerLongPressTimerRef.current = null;
        peerLongPressDidNavigateRef.current = true;
        router.push(`/u/${peerProfileId}`);
      }, 520);
    },
    [clearPeerLongPressTimer, peerProfileId, router]
  );

  const onChatPeerPointerUp = useCallback(() => {
    clearPeerLongPressTimer();
  }, [clearPeerLongPressTimer]);

  const onChatPeerClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!peerProfileId) return;
      if (peerLongPressDidNavigateRef.current) {
        peerLongPressDidNavigateRef.current = false;
        e.preventDefault();
        return;
      }
      const n = e.nativeEvent as unknown as { pointerType?: string };
      if (n.pointerType === "touch") {
        e.preventDefault();
        return;
      }
      router.push(`/u/${peerProfileId}`);
    },
    [peerProfileId, router]
  );

  const scrollToMessageId = useCallback((id: string) => {
    const el = rowRefs.current.get(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const goToAdjacentPin = useCallback(
    (delta: number) => {
      if (pins.length === 0) return;
      const cur =
        Number.isFinite(pinIndex) ? Math.max(0, Math.min(pinIndex, pins.length - 1)) : 0;
      const next = (cur + delta + pins.length) % pins.length;
      setPinIndex(next);
      const id = pins[next]?.messageId;
      if (id) {
        queueMicrotask(() => {
          requestAnimationFrame(() => scrollToMessageId(id));
        });
      }
    },
    [pinIndex, pins, scrollToMessageId]
  );

  useEffect(() => {
    setPinIndex((prev) => {
      if (!pins.length) return 0;
      return Math.max(0, Math.min(prev, pins.length - 1));
    });
  }, [pins.length]);

  const loadConversations = useCallback(
    async (selectedConversationId?: string | null, opts?: { silent?: boolean }) => {
      try {
        if (!opts?.silent) setLoadingList(true);
        const result = await apiRequest(`/messages/conversations/${userId}`);
        const list = result.conversations ?? [];
        setConversations(list);

        setCurrentConversationId((prev) => {
          if (selectedConversationId) return selectedConversationId;
          if (!prev) return list[0]?.id ?? null;
          if (list.some((c: any) => c.id === prev)) return prev;
          // Пока ответ догоняет список, не прыгать на чужой диалог (из‑за этого «отваливались» ввод и отправка)
          return prev;
        });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Ошибка загрузки диалогов";
        setMessage(text);
      } finally {
        if (!opts?.silent) setLoadingList(false);
      }
    },
    [userId]
  );

  const fetchMessagesPage = useCallback(
    async (conversationId: string, opts?: { before?: string; after?: string }) => {
      const result = await apiRequest(`/messages/${conversationId}`, {
        query: {
          userId,
          limit: MESSAGE_PAGE,
          ...(opts?.before ? { before: opts.before } : {}),
          ...(opts?.after ? { after: opts.after } : {}),
        },
      });
      return {
        messages: result.messages ?? [],
        pins: (result.pins ?? []) as PinRow[],
        hasMore: !!result.hasMore,
      };
    },
    [userId]
  );

  const loadMessagesInitial = useCallback(
    async (conversationId: string, showLoading = false) => {
      try {
        if (showLoading) setLoadingMessages(true);
        pollSkipRef.current = true;
        const { messages: rows, pins: pinRows, hasMore } = await fetchMessagesPage(conversationId);
        scrollToBottomAfterMessagesRef.current = true;
        setMessages(rows);
        setPins(pinRows);
        setHasOlder(hasMore);
        await apiRequest("/messages/read", {
          method: "POST",
          body: JSON.stringify({ userId, conversationId }),
        });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Ошибка загрузки сообщений";
        setMessage(text);
      } finally {
        if (showLoading) setLoadingMessages(false);
        pollSkipRef.current = false;
      }
    },
    [fetchMessagesPage, userId]
  );

  const pollMessages = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (pollInFlightRef.current) return;
    if (!currentConversationId || pollSkipRef.current || loadingOlder) return;
    pollInFlightRef.current = true;
    try {
      const lastId = messagesEndIdRef.current;
      const { messages: incoming, pins: pinRows } = lastId
        ? await fetchMessagesPage(currentConversationId, { after: lastId })
        : await fetchMessagesPage(currentConversationId);
      setPins(pinRows);
      setMessages((prev) => {
        if (!incoming.length) return prev;
        if (!prev.length) return incoming;
        return mergeMessageListsById(prev, incoming);
      });
      await apiRequest("/messages/read", {
        method: "POST",
        body: JSON.stringify({ userId, conversationId: currentConversationId }),
      });
    } catch {
      /* сеть/сервер — не сыпем логом на каждом тикe */
    } finally {
      pollInFlightRef.current = false;
    }
  }, [currentConversationId, fetchMessagesPage, loadingOlder, userId]);

  const loadOlder = useCallback(async () => {
    if (!currentConversationId || !messages.length || !hasOlder || loadingOlder) return;
    const oldestId = messages[0].id;
    const area = messagesAreaRef.current;
    scrollPreserve.current = area
      ? { height: area.scrollHeight, top: area.scrollTop }
      : null;
    try {
      setLoadingOlder(true);
      pollSkipRef.current = true;
      const { messages: older, pins: pinRows, hasMore } = await fetchMessagesPage(
        currentConversationId,
        { before: oldestId }
      );
      setPins(pinRows);
      setHasOlder(hasMore);
      setMessages((prev) => mergeMessageListsById(prev, older));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось подгрузить историю");
    } finally {
      setLoadingOlder(false);
      pollSkipRef.current = false;
    }
  }, [currentConversationId, fetchMessagesPage, hasOlder, loadingOlder, messages]);

  useLayoutEffect(() => {
    const area = messagesAreaRef.current;
    if (area && scrollToBottomAfterMessagesRef.current && !scrollPreserve.current) {
      scrollToBottomAfterMessagesRef.current = false;
      area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
    }
    const prev = scrollPreserve.current;
    if (!area || !prev) return;
    const delta = area.scrollHeight - prev.height;
    area.scrollTop = prev.top + delta;
    scrollPreserve.current = null;
  }, [messages]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    messagesEndIdRef.current = messages[messages.length - 1]?.id ?? null;
  }, [messages]);

  useEffect(() => {
    if (!withUserId) return;
    (async () => {
      try {
        const result = await apiRequest(`/messages/direct/${userId}/${withUserId}`);
        await loadConversations(result.conversation.id);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Не удалось открыть диалог");
      }
    })();
  }, [loadConversations, userId, withUserId]);

  useEffect(() => {
    if (!currentConversationId) {
      setMessages([]);
      setPins([]);
      setHasOlder(false);
      setPendingReply(null);
      setContextMenu(null);
      return;
    }
    void loadMessagesInitial(currentConversationId, true);
    const interval = setInterval(() => {
      void pollMessages();
    }, 4000);
    return () => clearInterval(interval);
  }, [currentConversationId, loadMessagesInitial, pollMessages]);

  useEffect(() => {
    const root = messagesAreaRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel || !hasOlder) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e?.isIntersecting) void loadOlder();
      },
      { root, rootMargin: "80px 0px 0px 0px", threshold: 0 }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasOlder, loadOlder, currentConversationId, messages.length]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const el = messageMenuRef.current;
      if (el && !el.contains(e.target as Node)) setContextMenu(null);
    };
    const onScroll = () => setContextMenu(null);
    window.addEventListener("keydown", onKey);
    /* bubble: сначала фокус/клик в поле ввода, потом закрытие меню (не перехватываем в capture) */
    window.addEventListener("pointerdown", onPointerDown, false);
    messagesAreaRef.current?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, false);
      messagesAreaRef.current?.removeEventListener("scroll", onScroll);
    };
  }, [contextMenu]);

  function openMessageContextMenu(e: React.MouseEvent, msg: any) {
    e.preventDefault();
    e.stopPropagation();
    const pad = 10;
    const mw = 288;
    const mh = 168;
    const x = Math.max(pad, Math.min(e.clientX, window.innerWidth - mw - pad));
    const y = Math.max(pad, Math.min(e.clientY, window.innerHeight - mh - pad));
    setContextMenu({ x, y, msg });
  }

  async function pinMessage(messageId: string) {
    if (!currentConversationId) return;
    try {
      await apiRequest(`/messages/${currentConversationId}/pin`, {
        method: "POST",
        body: JSON.stringify({ userId, messageId }),
      });
      const { pins: pinRows } = await fetchMessagesPage(currentConversationId);
      setPins(pinRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось закрепить");
    }
  }

  async function reportMessage(messageId: string) {
    if (!currentConversationId) return;
    const reason = window.prompt("Кратко опиши нарушение (необязательно). Отмена — не слать.");
    if (reason === null) return;
    try {
      setMessage("");
      await apiRequest("/messages/report", {
        method: "POST",
        body: JSON.stringify({
          userId,
          conversationId: currentConversationId,
          messageId,
          reason: reason.trim() || undefined,
        }),
      });
      setMessage("Жалоба отправлена модераторам. Спасибо.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отправить жалобу");
    } finally {
      setContextMenu(null);
    }
  }

  async function unpinMessage(messageId: string) {
    if (!currentConversationId) return;
    try {
      await apiRequest(`/messages/${currentConversationId}/pin/${messageId}`, {
        method: "DELETE",
        query: { userId },
      });
      const { pins: pinRows } = await fetchMessagesPage(currentConversationId);
      setPins(pinRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось снять закрепление");
    }
  }

  async function handleImageUpload(file: File) {
    if (!currentConversationId && !withUserId) {
      setMessage("Сначала выбери диалог");
      return;
    }

    setUploadingImage(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "message");

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");

      const imageUrl = data.urls?.[0];
      if (!imageUrl) throw new Error("Не получен URL изображения");

      const replyToId = pendingReply?.id ?? undefined;
      const replySnap = pendingReply?.replyTo ?? null;
      const result = await apiRequest("/messages/send", {
        method: "POST",
        body: JSON.stringify({
          userId,
          conversationId: currentConversationId,
          targetUserId: currentConversationId ? undefined : withUserId ?? undefined,
          content: text.trim() || null,
          imageUrl,
          sharedPostId: sharePostId || null,
          ...(replyToId ? { replyToId } : {}),
        }),
      });

      const newConversationId = result.conversationId;
      if (result.message?.id) {
        scrollToBottomAfterMessagesRef.current = true;
        const shaped = buildMessageFromSendResult(
          result.message,
          { username: viewerUsername, avatarUrl: viewerAvatarUrl },
          replySnap,
          { shareTitle, sharePostSlug }
        );
        setMessages((prev) => {
          const cid = String(newConversationId);
          if (prev.length && !prev.every((m) => String(m.conversationId) === cid)) {
            return prev;
          }
          return mergeMessageListsById(prev, [shaped]);
        });
      } else {
        await loadMessagesInitial(newConversationId, false);
      }

      setText("");
      setPendingReply(null);
      setCurrentConversationId(newConversationId);

      const params = new URLSearchParams(searchParams.toString());
      params.delete("sharePostId");
      params.delete("sharePostSlug");
      params.delete("shareTitle");
      router.replace(`/messages${params.toString() ? `?${params.toString()}` : ""}`);

      await loadConversations(newConversationId, { silent: true });
      queueMicrotask(() => textareaRef.current?.focus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка отправки изображения");
    } finally {
      setUploadingImage(false);
    }
  }

  async function sendMessage() {
    const hasContent = text.trim().length > 0;
    const hasShare = !!sharePostId;

    if (!currentConversationId && !withUserId) {
      setMessage("Сначала выбери диалог");
      return;
    }

    if (!hasContent && !hasShare) {
      return;
    }

    try {
      setMessage("");

      const replyToId = pendingReply?.id ?? undefined;
      const replySnap = pendingReply?.replyTo ?? null;
      const result = await apiRequest("/messages/send", {
        method: "POST",
        body: JSON.stringify({
          userId,
          conversationId: currentConversationId,
          targetUserId: currentConversationId ? undefined : withUserId ?? undefined,
          content: text.trim() || null,
          sharedPostId: sharePostId || null,
          ...(replyToId ? { replyToId } : {}),
        }),
      });

      const newConversationId = result.conversationId;
      if (result.message?.id) {
        scrollToBottomAfterMessagesRef.current = true;
        const shaped = buildMessageFromSendResult(
          result.message,
          { username: viewerUsername, avatarUrl: viewerAvatarUrl },
          replySnap,
          { shareTitle, sharePostSlug }
        );
        setMessages((prev) => {
          const cid = String(newConversationId);
          if (prev.length && !prev.every((m) => String(m.conversationId) === cid)) {
            return prev;
          }
          return mergeMessageListsById(prev, [shaped]);
        });
      } else {
        await loadMessagesInitial(newConversationId, false);
      }

      setText("");
      setPendingReply(null);
      setCurrentConversationId(newConversationId);

      const params = new URLSearchParams(searchParams.toString());
      params.delete("sharePostId");
      params.delete("sharePostSlug");
      params.delete("shareTitle");
      router.replace(`/messages${params.toString() ? `?${params.toString()}` : ""}`);

      await loadConversations(newConversationId, { silent: true });
      queueMicrotask(() => textareaRef.current?.focus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка отправки");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent.isComposing) return;
    const legacy = (e as unknown as { keyCode?: number }).keyCode;
    if (legacy === 229) return;
    e.preventDefault();
    void sendMessage();
  }

  function startReply(msg: any) {
    const replyTo: ReplyPreview = {
      id: msg.id,
      senderId: msg.senderId,
      type: msg.type,
      content: msg.content ?? null,
      imageUrl: msg.imageUrl ?? null,
      sender: msg.sender ?? null,
    };
    setPendingReply({ id: msg.id, replyTo });
    textareaRef.current?.focus();
  }

  const pendingReplyTitle = pendingReply
    ? `В ответ ${shortSenderLabel(pendingReply.replyTo.sender?.username)}`
    : "";
  const pendingReplySub = pendingReply ? replySnippet(pendingReply.replyTo) : "";

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarBody}>
            <SimpleBar
              className={styles.sidebarScrollHost}
              autoHide={false}
              clickOnTrack
            >
              {loadingList ? (
                <div className={styles.empty}>Загрузка диалогов...</div>
              ) : conversations.length === 0 ? (
                <div className={styles.empty}>
                  У тебя пока нет диалогов. Открой профиль друга и нажми «Написать».
                </div>
              ) : (
                <div className={styles.conversationList}>
                  {conversations.map((conv: any) => (
                    <button
                      key={conv.id}
                      type="button"
                      className={`${styles.conversationItem} ${
                        currentConversationId === conv.id ? styles.activeConversation : ""
                      }`}
                      onClick={() => setCurrentConversationId(conv.id)}
                    >
                      <div className={styles.conversationTop}>
                        {conv.otherUser?.avatarUrl ? (
                          <img
                            src={conv.otherUser.avatarUrl}
                            alt={conv.otherUser.username}
                            className={styles.conversationAvatar}
                          />
                        ) : (
                          <div className={styles.conversationAvatarPlaceholder}>
                            {(conv.otherUser?.username?.[0] ?? "U").toUpperCase()}
                          </div>
                        )}
                        <div className={styles.conversationInfo}>
                          <div className={styles.conversationName}>
                            {conv.otherUser?.username ?? "Диалог"}
                          </div>
                          {conv.lastMessage ? (
                            <div className={styles.conversationPreview}>
                              {conv.lastMessage.type === "post_share"
                                ? `📎 ${conv.lastMessage.sharedPost?.title ?? "Пост"}`
                                : conv.lastMessage.type === "image"
                                  ? "📷 Изображение"
                                  : conv.lastMessage.content ?? "Сообщение"}
                            </div>
                          ) : (
                            <div className={styles.conversationPreview}>Пока нет сообщений</div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </SimpleBar>
          </div>
        </aside>

        <section className={styles.chat}>
          {currentConversationId || withUserId ? (
            <>
              <div className={styles.chatHeader}>
                <div className={styles.chatTitleWrap}>
                  <button
                    type="button"
                    className={styles.chatPeerBtn}
                    disabled={!peerProfileId}
                    title={
                      peerProfileId
                        ? "С телефона: удерживайте, чтобы открыть профиль. С ПК: обычный клик."
                        : undefined
                    }
                    aria-label={
                      peerProfileId
                        ? `Собеседник ${peerUsername}. Удержание — профиль, клик мышью — профиль.`
                        : "Собеседник"
                    }
                    onPointerDown={onChatPeerPointerDown}
                    onPointerUp={onChatPeerPointerUp}
                    onPointerCancel={onChatPeerPointerUp}
                    onPointerLeave={onChatPeerPointerUp}
                    onClick={onChatPeerClick}
                  >
                    <span className={styles.chatPeerBtnLabel}>{peerUsername}</span>
                  </button>
                  <Link href="/friends" className={styles.chatFriendsBtn}>
                    Друзья
                  </Link>
                </div>
              </div>

              {pins.length > 0 && (
                <div className={styles.pinsBar}>
                  {(() => {
                    const safeIndex = Number.isFinite(pinIndex)
                      ? Math.max(0, Math.min(pinIndex, pins.length - 1))
                      : 0;
                    const pin = pins[safeIndex];
                    if (!pin) return null;
                    const senderRaw = pin.preview?.sender?.username;
                    const sender = senderRaw ? shortSenderLabel(senderRaw) : "Сообщение";
                    const text = pin.preview?.text ?? "Сообщение";
                    const counter = pins.length > 1 ? `${safeIndex + 1}/${pins.length}` : null;
                    return (
                      <div className={styles.pinTelegram}>
                        <button
                          type="button"
                          className={styles.pinTelegramMain}
                          onClick={() => scrollToMessageId(pin.messageId)}
                          title="Перейти к сообщению"
                        >
                          <div className={styles.pinAccent} aria-hidden />
                          <div className={styles.pinBody}>
                            <div className={styles.pinTop}>
                              <span className={styles.pinGlyph} aria-hidden />
                              <span className={styles.pinTitle}>Закреплённое сообщение</span>
                              {counter ? <span className={styles.pinCounter}>{counter}</span> : null}
                            </div>
                            <div className={styles.pinText}>
                              <span className={styles.pinSender}>{sender}:</span> {text}
                            </div>
                          </div>
                        </button>

                        {pins.length > 1 ? (
                          <div className={styles.pinNav} aria-label="Навигация по закрепам">
                            <button
                              type="button"
                              className={styles.pinNavBtn}
                              onClick={() => goToAdjacentPin(-1)}
                              aria-label="Предыдущий закреп"
                              title="Предыдущий"
                            >
                              ‹
                            </button>
                            <button
                              type="button"
                              className={styles.pinNavBtn}
                              onClick={() => goToAdjacentPin(1)}
                              aria-label="Следующий закреп"
                              title="Следующий"
                            >
                              ›
                            </button>
                          </div>
                        ) : null}

                        <button
                          type="button"
                          className={styles.pinClose}
                          title="Снять закрепление"
                          aria-label="Снять закрепление"
                          onClick={() => void unpinMessage(pin.messageId)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}

              {sharePostId && (
                <div className={styles.shareBanner}>
                  <div className={styles.shareTitle}>Готово к отправке другу:</div>
                  <div className={styles.sharePostTitle}>{shareTitle || "Интересный пост"}</div>
                  <div className={styles.shareHint}>
                    Можешь добавить комментарий и отправить пост в этот диалог.
                  </div>
                </div>
              )}

              {message && <div className={styles.systemMessage}>{message}</div>}

              <SimpleBar
                key={currentConversationId ?? "none"}
                className={styles.messagesScrollHost}
                autoHide={false}
                clickOnTrack
                scrollableNodeProps={{
                  ref: messagesAreaRef,
                  className: styles.messagesScrollViewport,
                }}
              >
                {loadingMessages ? (
                  <div className={styles.empty}>Загрузка сообщений...</div>
                ) : messages.length === 0 ? (
                  <div className={styles.empty}>Пока нет сообщений. Начни разговор первым.</div>
                ) : (
                  <>
                    <div ref={topSentinelRef} style={{ height: 1 }} aria-hidden />
                    {hasOlder && loadingOlder ? (
                      <div className={styles.loadOlder} aria-live="polite">
                        Загружаю историю при прокрутке вверх…
                      </div>
                    ) : null}
                    {buildMessageTimeline(messages).map((entry) => {
                      if (entry.kind === "day") {
                        return (
                          <div key={entry.key} className={styles.dateSeparator}>
                            <span className={styles.dateSeparatorPill}>{entry.label}</span>
                          </div>
                        );
                      }
                      const msg = entry.msg;
                      const mine = msg.senderId === userId;
                      const rt = msg.replyTo as ReplyPreview | null | undefined;
                      const fullTimeTitle = msg.createdAt
                        ? new Date(msg.createdAt as string).toLocaleString("ru-RU")
                        : undefined;
                      return (
                        <div
                          key={msg.id as string}
                          ref={(el) => {
                            if (el) rowRefs.current.set(msg.id as string, el);
                            else rowRefs.current.delete(msg.id as string);
                          }}
                          className={`${styles.messageRow} ${
                            mine ? styles.myMessageRow : styles.otherMessageRow
                          }`}
                        >
                          <div
                            className={`${styles.messageBubble} ${
                              mine ? styles.myMessageBubble : styles.otherMessageBubble
                            }`}
                            onContextMenuCapture={(e) => openMessageContextMenu(e, msg)}
                          >
                            {msg.replyToId && rt ? (
                              <button
                                type="button"
                                className={styles.replyQuoteInBubble}
                                onClick={() => scrollToMessageId(rt.id)}
                              >
                                <div className={styles.replyQuoteName}>
                                  {shortSenderLabel(rt.sender?.username)}
                                </div>
                                <div className={styles.replyQuoteSnippet}>{replySnippet(rt)}</div>
                              </button>
                            ) : null}

                            {msg.type === "post_share" && msg.sharedPost ? (
                              <Link href={`/posts/${msg.sharedPost.slug}`} className={styles.sharedPostCard}>
                                {msg.sharedPost.coverImage ? (
                                  <img
                                    src={msg.sharedPost.coverImage}
                                    alt={msg.sharedPost.title}
                                    className={styles.sharedPostImage}
                                  />
                                ) : (
                                  <div className={styles.sharedPostImagePlaceholder}>🎮</div>
                                )}
                                <div className={styles.sharedPostBody}>
                                  <div className={styles.sharedPostLabel}>Пересланный пост</div>
                                  <div className={styles.sharedPostTitleText}>
                                    {msg.sharedPost.title}
                                  </div>
                                </div>
                              </Link>
                            ) : msg.type === "image" && msg.imageUrl ? (
                              <button
                                type="button"
                                className={styles.messageImageBtn}
                                onClick={() => setLightboxUrl(msg.imageUrl)}
                              >
                                <img
                                  src={msg.imageUrl}
                                  alt="Отправленное изображение"
                                  className={styles.messageImage}
                                />
                              </button>
                            ) : null}

                            {msg.content ? (
                              <div className={styles.messageText}>{msg.content as string}</div>
                            ) : null}

                            <div className={styles.messageBubbleFooter}>
                              <time
                                className={styles.messageTime}
                                dateTime={typeof msg.createdAt === "string" ? msg.createdAt : undefined}
                                title={fullTimeTitle}
                              >
                                {formatMessageTime(msg.createdAt as string | null)}
                              </time>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </SimpleBar>

              <div className={styles.composer} data-messages-composer>
                {pendingReply && (
                  <div className={styles.replyPreviewBar}>
                    <button
                      type="button"
                      className={styles.replyPreviewBarClick}
                      onClick={() => scrollToMessageId(pendingReply.id)}
                    >
                      <div className={styles.replyPreviewAccent} />
                      {pendingReply.replyTo.imageUrl ? (
                        <img
                          src={pendingReply.replyTo.imageUrl}
                          alt=""
                          className={styles.replyPreviewThumb}
                        />
                      ) : pendingReply.replyTo.sender?.avatarUrl ? (
                        <img
                          src={pendingReply.replyTo.sender.avatarUrl}
                          alt=""
                          className={styles.replyPreviewThumb}
                        />
                      ) : null}
                      <div style={{ minWidth: 0 }}>
                        <div className={styles.replyPreviewTitle}>{pendingReplyTitle}</div>
                        <div className={styles.replyPreviewSub}>{pendingReplySub}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={styles.replyPreviewClose}
                      aria-label="Отменить ответ"
                      onClick={() => setPendingReply(null)}
                    >
                      ×
                    </button>
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  enterKeyHint="send"
                  className={styles.textarea}
                  rows={3}
                  placeholder={
                    sharePostId
                      ? "Добавь комментарий к пересылаемому посту..."
                      : "Напиши сообщение..."
                  }
                  disabled={uploadingImage}
                />

                <div className={styles.composerActions}>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handleImageUpload(file);
                        e.target.value = "";
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={styles.attachButton}
                    disabled={uploadingImage}
                    onClick={() => fileInputRef.current?.click()}
                    title="Прикрепить изображение"
                  >
                    📷
                  </button>

                  <button
                    type="button"
                    className={styles.sendButton}
                    disabled={uploadingImage || (!text.trim() && !sharePostId)}
                    onClick={() => void sendMessage()}
                  >
                    {uploadingImage
                      ? "Загрузка…"
                      : sharePostId
                        ? "Отправить пост"
                        : "Отправить"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className={styles.emptyLarge}>
              {sharePostId
                ? "Выбери друга слева, чтобы переслать пост и обсудить его."
                : "Выбери диалог слева или открой чат из профиля друга."}
            </div>
          )}
        </section>
      </div>

      {contextMenu && (
        <div
          ref={messageMenuRef}
          className={styles.messageContextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className={styles.messageContextMenuHeader}>
            {shortSenderLabel(contextMenu.msg.sender?.username)} ·{" "}
            {formatMessageTime(contextMenu.msg.createdAt)}
          </div>
          <div className={styles.messageContextMenuRow}>
            <button
              type="button"
              className={styles.messageContextMenuBtn}
              role="menuitem"
              onClick={() => {
                startReply(contextMenu.msg);
                setContextMenu(null);
              }}
            >
              <span className={styles.messageContextMenuIcon} aria-hidden>
                ↩
              </span>
              Ответить
            </button>
            <button
              type="button"
              className={styles.messageContextMenuBtn}
              role="menuitem"
              onClick={() => {
                void pinMessage(contextMenu.msg.id);
                setContextMenu(null);
              }}
            >
              <span className={styles.messageContextMenuIcon} aria-hidden>
                📌
              </span>
              Закрепить
            </button>
            {contextMenu.msg.senderId !== userId ? (
              <button
                type="button"
                className={styles.messageContextMenuBtn}
                role="menuitem"
                onClick={() => {
                  void reportMessage(contextMenu.msg.id);
                }}
              >
                <span className={styles.messageContextMenuIcon} aria-hidden>
                  ⚑
                </span>
                Пожаловаться
              </button>
            ) : null}
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          className={styles.lightbox}
          role="presentation"
          onClick={() => setLightboxUrl(null)}
        >
          <div className={styles.lightboxInner} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.lightboxClose}
              aria-label="Закрыть"
              onClick={() => setLightboxUrl(null)}
            >
              ×
            </button>
            <img src={lightboxUrl} alt="" className={styles.lightboxImg} />
          </div>
        </div>
      )}
    </div>
  );
}
