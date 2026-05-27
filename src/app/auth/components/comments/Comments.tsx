"use client";

import { useEffect, useState, useCallback } from "react";

import type { CommentNode, PostCommentsResponse } from "@/types/comments";
import { ModerationBlockedMirrorTextarea } from "@/components/ModerationBlockedMirrorField";
import { readModerationBlockedPayload } from "@/lib/moderation/parse-blocked-response";
import type { ModerationTextMatch } from "@/lib/moderation/moderate-text";
import { requestModerationPreview } from "@/lib/moderation/preview-api";
import { useBanRestriction } from "@/contexts/BanRestrictionContext";
import { formatBanCountdown } from "@/lib/ban-countdown";
import { patchCommentReactions } from "@/lib/comment-tree";
import CommentItem from "./CommentItem";
import "./Comments.css";

function countCommentNodes(nodes: CommentNode[]): number {
  let total = 0;
  const stack: CommentNode[] = [...nodes];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    total += 1;
    if (Array.isArray(n.replies) && n.replies.length) {
      for (const r of n.replies) stack.push(r);
    }
  }
  return total;
}

function formatCompactCount(n: number): string {
  const value = Number.isFinite(n) ? Math.max(0, n) : 0;
  if (value < 1000) return String(value);
  const k = value / 1000;
  const rounded = k < 10 ? Math.round(k * 10) / 10 : Math.round(k);
  const s = String(rounded).replace(".", ",");
  return `${s}K`;
}

type SortMode = "new" | "old" | "top";

export default function Comments({
  postSlug,
  userId,
  viewerRole = "user",
}: {
  postSlug: string;
  userId: string | null;
  viewerRole?: string;
}) {
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiReviewReady, setAiReviewReady] = useState(false);
  const [error, setError] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const [modBlock, setModBlock] = useState<{
    text: string;
    matches: ModerationTextMatch[];
  } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("new");
  const ban = useBanRestriction();
  const commentBlocked = ban.restricted;

  const loadComments = useCallback(async () => {
    if (!postSlug) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch(`/api/posts/${encodeURIComponent(postSlug)}/comments`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Failed to load comments: ${res.status}`);
      }

      const data = (await res.json()) as PostCommentsResponse;
      setComments(Array.isArray(data.comments) ? data.comments : []);
    } catch (err) {
      console.error("Failed to load comments:", err);
      setError("Не удалось загрузить комментарии");
    } finally {
      setLoading(false);
    }
  }, [postSlug]);

  useEffect(() => {
    void loadComments();
  }, [loadComments, userId]);

  async function postComment(contentToSend: string, parentId: string | null) {
    const res = await fetch(`/api/posts/${encodeURIComponent(postSlug)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        content: contentToSend,
        parentId,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const blocked = readModerationBlockedPayload(data);
      if (blocked) {
        setModBlock({ text: contentToSend, matches: blocked.matches });
      }
      throw new Error(typeof data.error === "string" ? data.error : "Не удалось отправить комментарий");
    }

    setModBlock(null);
    setText("");
    setAiReviewReady(false);
    setListOpen(true);
    await loadComments();
  }

  async function addComment(parentId: string | null = null) {
    const content = text.trim();

    if (!userId) {
      setError("Сначала войди в аккаунт");
      return;
    }

    if (commentBlocked) {
      setError("Сейчас нельзя отправлять комментарии.");
      return;
    }

    if (!content) {
      setError("Комментарий не может быть пустым");
      return;
    }
    if (!postSlug) {
      setError("Ошибка: slug поста не определён");
      return;
    }

    setError("");
    setModBlock(null);

    if (aiReviewReady) {
      setSending(true);
      try {
        await postComment(content, parentId);
        setAiNotice("");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Ошибка отправки комментария");
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    setAiChecking(true);
    setAiNotice("");

    try {
      const preview = await requestModerationPreview({
        text: content,
        scope: "comments",
        userId,
        sourceField: "comment",
      });
      if (preview.blocked) {
        setModBlock({ text: content, matches: preview.matches });
        setError("Текст содержит запрещённые выражения. Исправьте подчёркнутые слова.");
        return;
      }

      if (preview.needsConfirm && preview.cleanText !== content) {
        setText(preview.cleanText);
        setAiReviewReady(true);
        setAiNotice(
          preview.aiModerationStatus === "failed"
            ? "ИИ не ответил — проверьте Gemini API. Текст можно править вручную, затем «Отправить»."
            : "Модерация применена в поле выше. Проверьте и нажмите «Отправить»."
        );
        return;
      }

      await postComment(content, parentId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка отправки комментария");
    } finally {
      setSending(false);
      setAiChecking(false);
    }
  }

  const handleReaction = useCallback(
    async (commentId: string, type: "like" | "dislike") => {
      if (!userId) {
        setError("Сначала войди в аккаунт");
        return;
      }

      try {
        const res = await fetch(`/api/comments/${commentId}/reaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            type,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          likeCount?: number;
          dislikeCount?: number;
          likedByMe?: boolean;
          dislikedByMe?: boolean;
        };

        if (!res.ok) {
          throw new Error(data.error || "Не удалось поставить реакцию");
        }

        if (
          typeof data.likeCount === "number" &&
          typeof data.dislikeCount === "number" &&
          typeof data.likedByMe === "boolean" &&
          typeof data.dislikedByMe === "boolean"
        ) {
          setComments((prev) =>
            patchCommentReactions(prev, commentId, {
              likeCount: data.likeCount!,
              dislikeCount: data.dislikeCount!,
              likedByMe: data.likedByMe!,
              dislikedByMe: data.dislikedByMe!,
            })
          );
        } else {
          await loadComments();
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Ошибка реакции");
      }
    },
    [userId, loadComments]
  );

  if (!postSlug) {
    return (
      <div className="comments-container">
        <h2 className="comments-title">Комментарии</h2>
        <div className="comments-error">Ошибка загрузки: slug поста не определён</div>
      </div>
    );
  }

  const totalCount = countCommentNodes(comments);
  const totalCountLabel = totalCount > 0 ? formatCompactCount(totalCount) : "0";

  const sortedTopLevel = [...comments].sort((a, b) => {
    if (sortMode === "old") {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    }
    if (sortMode === "top") {
      const sa = (a.likeCount ?? 0) - (a.dislikeCount ?? 0);
      const sb = (b.likeCount ?? 0) - (b.dislikeCount ?? 0);
      if (sb !== sa) return sb - sa;
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    }
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  return (
    <div className="comments-container">
      <h2 className="comments-title">
        Комментарии <span className="comments-count">({totalCountLabel})</span>
      </h2>

      <div className="comments-editor">
        {commentBlocked ? (
          <div className="comments-ban-notice" role="alert">
            <strong>Аккаунт в бане.</strong> Вы не можете писать комментарии
            {ban.permanent ? "." : ban.bannedUntilMs ? ` ещё ${formatBanCountdown(ban.remainingMs)}.` : "."}
          </div>
        ) : null}
        {aiChecking ? (
          <div className="comments-ai-checking" role="status">
            ИИ модерирует текст по правилам…
          </div>
        ) : null}
        {aiReviewReady && aiNotice ? (
          <div className="comments-ai-notice" role="status">
            {aiNotice}
          </div>
        ) : null}
        {modBlock ? (
          <ModerationBlockedMirrorTextarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setModBlock(null);
              setAiReviewReady(false);
            }}
            matches={modBlock.matches}
            shellClassName="comments-textarea-mirror-shell"
            textareaClassName="comments-textarea-mirror-inner"
            rows={4}
            disabled={sending || commentBlocked || aiChecking}
            placeholder="Написать комментарий... (Enter — отправить, Shift+Enter — новая строка)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void addComment();
              }
            }}
          />
        ) : (
          <textarea
            className={`comments-textarea${aiReviewReady ? " comments-textarea-ai-ready" : ""}`}
            placeholder="Написать комментарий... (Enter — отправить, Shift+Enter — новая строка)"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setAiReviewReady(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void addComment();
              }
            }}
            rows={4}
            disabled={sending || commentBlocked || aiChecking}
          />
        )}

        {error ? <div className="comments-error">{error}</div> : null}

        <div className="comments-editor-actions">
          <button
            className="comments-submit-button"
            onClick={() => void addComment()}
            disabled={sending || !text.trim() || commentBlocked || aiChecking}
          >
            {aiChecking ? "ИИ проверяет…" : sending ? "Отправка..." : aiReviewReady ? "Отправить" : "Проверить и отправить"}
          </button>
        </div>
      </div>

      <div className="comments-controls">
        <button
          type="button"
          className="comments-toggle"
          onClick={() => setListOpen((v) => !v)}
          disabled={loading}
          aria-expanded={listOpen}
        >
          {listOpen ? "Свернуть комментарии" : "Показать комментарии"}
        </button>

        <label className="comments-sort">
          <span className="comments-sort-label">Сортировка</span>
          <select
            className="comments-sort-select"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            disabled={loading}
          >
            <option value="new">Сначала новые</option>
            <option value="old">Сначала старые</option>
            <option value="top">Сначала популярные</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="comments-list-loading" aria-busy="true">
          Загрузка комментариев…
        </div>
      ) : !listOpen ? (
        <div className="comments-collapsed-hint">
          Комментарии скрыты. Нажмите «Показать», чтобы развернуть.
        </div>
      ) : comments.length === 0 ? (
        <div className="comments-empty">Пока нет комментариев. Будьте первым!</div>
      ) : (
        <div className="comments-list">
          {sortedTopLevel.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              postSlug={postSlug}
              userId={userId}
              viewerRole={viewerRole}
              onUpdate={loadComments}
              onReaction={handleReaction}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
