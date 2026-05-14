"use client";

import { useEffect, useMemo, useState, memo } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import type { CommentNode } from "@/types/comments";
import { ModerationBlockedMirrorTextarea } from "@/components/ModerationBlockedMirrorField";
import { readModerationBlockedPayload } from "@/lib/moderation/parse-blocked-response";
import type { ModerationTextMatch } from "@/lib/moderation/moderate-text";
import { useBanRestriction } from "@/contexts/BanRestrictionContext";
import { isStaffRole } from "@/lib/roles";
import ConfirmDialog from "@/app/auth/components/ui/ConfirmDialog";
import CommentReportDialog from "./CommentReportDialog";
import "./CommentItem.css";

interface CommentItemProps {
  comment: CommentNode;
  postSlug: string;
  userId: string | null;
  viewerRole: string;
  onUpdate: () => void;
  onReaction: (commentId: string, type: "like" | "dislike") => Promise<void>;
  depth: number;
}

export default memo(function CommentItem({
  comment,
  postSlug,
  userId,
  viewerRole,
  onUpdate,
  onReaction,
  depth,
}: CommentItemProps) {
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [modBlockReply, setModBlockReply] = useState<{
    text: string;
    matches: ModerationTextMatch[];
  } | null>(null);
  const [modBlockEdit, setModBlockEdit] = useState<{
    text: string;
    matches: ModerationTextMatch[];
  } | null>(null);
  const ban = useBanRestriction();
  const commentBlocked = ban.restricted;

  useEffect(() => {
    if (!editing) {
      setEditText(comment.content);
    }
  }, [comment.content, comment.id, editing]);

  const isStaff = isStaffRole(viewerRole);
  const isAuthor = userId !== null && userId === comment.author.id;
  const canDeleteOwn = isAuthor && !comment.isDeleted;
  const profileHref = comment.author.id ? `/u/${comment.author.id}` : null;

  /** Чужой удалённый комментарий: без автора; свои формулировки только автору комментария */
  const hideHeaderDeletedOther = comment.isDeleted && !isAuthor;

  function countDescendants(node: CommentNode): number {
    let total = 0;
    const stack: CommentNode[] = Array.isArray(node.replies) ? [...node.replies] : [];
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
    return `${String(rounded).replace(".", ",")}K`;
  }

  const replyTotal = countDescendants(comment);

  function deletedBodyText(): string {
    if (!comment.isDeleted) return comment.content;
    if (!isAuthor) return "Удалённый комментарий.";
    return comment.deletedBySelf
      ? "Вы удалили этот комментарий."
      : "Администрация удалила ваш комментарий.";
  }

  const timeAgo = useMemo(
    () =>
      comment.createdAt
        ? formatDistanceToNow(new Date(comment.createdAt), {
            addSuffix: true,
            locale: ru,
          })
        : "недавно",
    [comment.createdAt]
  );

  async function submitReply() {
    const content = replyText.trim();

    if (!userId) {
      setError("Сначала войди в аккаунт");
      return;
    }

    if (commentBlocked) {
      setError("В бане нельзя отвечать на комментарии.");
      return;
    }

    if (!content) return;

    if (!postSlug || postSlug === "undefined") {
      setError("Ошибка: slug поста не найден");
      return;
    }

    setSending(true);
    setError("");
    setSuccessMsg("");
    setModBlockReply(null);

    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(postSlug)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          content,
          parentId: comment.id,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const blocked = readModerationBlockedPayload(data);
        if (blocked) {
          setModBlockReply({ text: content, matches: blocked.matches });
        }
        throw new Error(typeof data.error === "string" ? data.error : "Ошибка отправки");
      }

      setModBlockReply(null);

      setReplyText("");
      setIsReplying(false);
      onUpdate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSending(false);
    }
  }

  async function confirmDeleteOwn() {
    if (!canDeleteOwn) return;

    setDeleteLoading(true);
    setError("");
    try {
      if (!userId) {
        throw new Error("Сначала войди в аккаунт");
      }
      const res = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Не удалось удалить");
      }
      setDeleteConfirmOpen(false);
      onUpdate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function saveEdit() {
    const content = editText.trim();
    if (!content) return;
    if (commentBlocked) {
      setError("Сейчас нельзя редактировать комментарии.");
      return;
    }
    setEditSaving(true);
    setError("");
    setModBlockEdit(null);
    try {
      if (!userId) {
        throw new Error("Сначала войди в аккаунт");
      }
      const res = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, content }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const blocked = readModerationBlockedPayload(data);
        if (blocked) {
          setModBlockEdit({ text: content, matches: blocked.matches });
        }
        throw new Error(typeof data.error === "string" ? data.error : "Ошибка сохранения");
      }

      setModBlockEdit(null);
      setEditing(false);
      onUpdate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setEditSaving(false);
    }
  }

  function onReplyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitReply();
    }
  }

  if (hideHeaderDeletedOther) {
    return (
      <div className="comment-item comment-item-deleted-other">
        <div className="comment-content comment-content-deleted comment-deleted-generic">
          {deletedBodyText()}
        </div>

        {comment.replies?.length > 0 ? (
          <>
            <button
              type="button"
              className="comment-replies-toggle"
              onClick={() => setRepliesOpen((v) => !v)}
              aria-expanded={repliesOpen}
            >
              {repliesOpen ? "Скрыть ответы" : `Показать ответы (${formatCompactCount(replyTotal)})`}
            </button>
            <div className={`comment-replies ${repliesOpen ? "open" : "closed"}`}>
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  postSlug={postSlug}
                  userId={userId}
                  viewerRole={viewerRole}
                  onUpdate={onUpdate}
                  onReaction={onReaction}
                  depth={depth + 1}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="comment-item">
      <div className="comment-header">
        {profileHref ? (
          <Link href={profileHref} className="comment-author">
            {comment.author.avatarUrl ? (
              // Лёгкий lazy img: без pipeline next/image — меньше нагрузка при длинных ветках комментариев
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={comment.author.avatarUrl}
                alt=""
                width={40}
                height={40}
                className="comment-avatar"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="comment-avatar-placeholder">
                {comment.author.username[0]?.toUpperCase() ?? "U"}
              </div>
            )}

            <div className="comment-author-info">
              <span className="comment-username">{comment.author.username}</span>
              <span className="comment-date">{timeAgo}</span>
            </div>
          </Link>
        ) : (
          <div className="comment-author comment-author-static">
            <div className="comment-avatar-placeholder">—</div>
            <div className="comment-author-info">
              <span className="comment-username">{comment.author.username}</span>
              <span className="comment-date">{timeAgo}</span>
            </div>
          </div>
        )}
      </div>

      {comment.editedByStaff && !comment.isDeleted ? (
        <div className="comment-edited-badge">Изменено модератором</div>
      ) : null}

      {editing && isAuthor && !comment.isDeleted ? (
        <div className="comment-edit-box">
          {modBlockEdit ? (
            <ModerationBlockedMirrorTextarea
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value);
                setModBlockEdit(null);
              }}
              matches={modBlockEdit.matches}
              shellClassName="comment-reply-textarea-mirror-shell"
              textareaClassName="comment-reply-textarea-mirror-inner"
              rows={3}
              disabled={editSaving}
            />
          ) : (
            <textarea
              className="comment-reply-textarea"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              disabled={editSaving}
            />
          )}
          <div className="comment-staff-actions">
            <button type="button" className="comment-staff-btn" onClick={() => void saveEdit()} disabled={editSaving}>
              {editSaving ? "…" : "Сохранить"}
            </button>
            <button
              type="button"
              className="comment-staff-btn ghost"
              onClick={() => {
                setEditing(false);
                setEditText(comment.content);
                setModBlockEdit(null);
              }}
              disabled={editSaving}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className={`comment-content ${comment.isDeleted ? "comment-content-deleted" : ""}`}>
          {comment.isDeleted ? deletedBodyText() : comment.content}
        </div>
      )}

      <div className="comment-actions">
        {!comment.isDeleted ? (
          <>
            <button
              type="button"
              className={`comment-action-button ${comment.likedByMe ? "liked" : ""}`}
              onClick={() => void onReaction(comment.id, "like")}
            >
              <span className="comment-action-icon">👍</span>
              {comment.likeCount > 0 ? (
                <span className="comment-action-count">{comment.likeCount}</span>
              ) : null}
            </button>

            <button
              type="button"
              className={`comment-action-button ${comment.dislikedByMe ? "disliked" : ""}`}
              onClick={() => void onReaction(comment.id, "dislike")}
            >
              <span className="comment-action-icon">👎</span>
              {comment.dislikeCount > 0 ? (
                <span className="comment-action-count">{comment.dislikeCount}</span>
              ) : null}
            </button>
          </>
        ) : null}

        {!comment.isDeleted ? (
          <button
            type="button"
            className="comment-reply-button"
            onClick={() => setIsReplying((v) => !v)}
            disabled={commentBlocked}
            title={commentBlocked ? "В бане нельзя отвечать" : undefined}
          >
            Ответить
          </button>
        ) : null}

        {canDeleteOwn ? (
          <button type="button" className="comment-delete-own" onClick={() => setDeleteConfirmOpen(true)}>
            Удалить
          </button>
        ) : null}

        {isStaff && !comment.isDeleted ? (
          <Link
            className="comment-mod-link"
            href={`/admin?tab=reports&openComment=${encodeURIComponent(comment.id)}`}
          >
            Модерация
          </Link>
        ) : null}

        {userId && !isAuthor && !comment.isDeleted && !isStaff ? (
          <button type="button" className="comment-report-link" onClick={() => setReportOpen(true)}>
            Пожаловаться
          </button>
        ) : null}

        {isStaff && !comment.isDeleted && (comment.staffReportCount ?? 0) > 0 ? (
          <span className="comment-staff-report-badge" title="Жалоб в очереди на этот комментарий">
            ⚠ {comment.staffReportCount}
          </span>
        ) : null}

        {/** "Изменить" убрано из действий (по требованию) */}

        {/** убрали дубль: модерация теперь только зелёной кнопкой */}
      </div>

      {successMsg ? <div className="comment-reply-success">{successMsg}</div> : null}
      {error ? <div className="comment-reply-error">{error}</div> : null}

      {isReplying && !comment.isDeleted ? (
        <div className="comment-reply-form">
          {modBlockReply ? (
            <ModerationBlockedMirrorTextarea
              value={replyText}
              onChange={(e) => {
                setReplyText(e.target.value);
                setModBlockReply(null);
              }}
              matches={modBlockReply.matches}
              shellClassName="comment-reply-textarea-mirror-shell"
              textareaClassName="comment-reply-textarea-mirror-inner"
              rows={2}
              autoFocus
              disabled={sending || commentBlocked}
              placeholder="Напишите ответ..."
              onKeyDown={onReplyKeyDown}
            />
          ) : (
            <textarea
              className="comment-reply-textarea"
              placeholder="Напишите ответ..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={onReplyKeyDown}
              rows={2}
              autoFocus
              disabled={sending || commentBlocked}
            />
          )}

          <div className="comment-reply-actions">
            <button
              className="comment-reply-submit"
              onClick={() => void submitReply()}
              disabled={sending || !replyText.trim() || commentBlocked}
            >
              {sending ? "Отправка..." : "Отправить"}
            </button>

            <button
              className="comment-reply-cancel"
              onClick={() => {
                setIsReplying(false);
                setReplyText("");
                setError("");
              }}
              disabled={sending}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => {
          if (!deleteLoading) setDeleteConfirmOpen(false);
        }}
        title="Удалить комментарий?"
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="danger"
        loading={deleteLoading}
        onConfirm={() => void confirmDeleteOwn()}
      />

      <CommentReportDialog
        open={reportOpen}
        commentId={comment.id}
        userId={userId}
        onClose={() => setReportOpen(false)}
        onSubmitted={() => {
          setSuccessMsg("Жалоба отправлена модераторам.");
          setError("");
        }}
      />

      {comment.replies?.length > 0 ? (
        <>
          <button
            type="button"
            className="comment-replies-toggle"
            onClick={() => setRepliesOpen((v) => !v)}
            aria-expanded={repliesOpen}
          >
            {repliesOpen ? "Скрыть ответы" : `Показать ответы (${formatCompactCount(replyTotal)})`}
          </button>
          <div className={`comment-replies ${repliesOpen ? "open" : "closed"}`}>
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                postSlug={postSlug}
                userId={userId}
                viewerRole={viewerRole}
                onUpdate={onUpdate}
                onReaction={onReaction}
                depth={depth + 1}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
});
