"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  ALL_BAN_DURATION_KEYS,
  BAN_DURATION_LABELS,
  type BanDurationKey,
} from "@/lib/ban-durations";
import { clampModerationText, MAX_MODERATION_TEXT_CHARS } from "@/lib/moderation-text-limit";
import { isStaffRole } from "@/lib/roles";

import "./CommentModerationDialog.css";

type Action = "delete_only" | "warn_and_delete" | "ban_and_delete";

export default function CommentModerationDialog({
  commentId,
  onClose,
  onDone,
  viewerRole,
}: {
  commentId: string;
  onClose: () => void;
  onDone: () => void;
  viewerRole: string;
}) {
  const [action, setAction] = useState<Action>("delete_only");
  const [reason, setReason] = useState("");
  const [banDuration, setBanDuration] = useState<BanDurationKey>("1h");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isStaffRole(viewerRole)) {
    return null;
  }

  async function submit() {
    setError("");
    if ((action === "warn_and_delete" || action === "ban_and_delete") && !reason.trim()) {
      setError("Укажите причину");
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/admin/comments/${encodeURIComponent(commentId)}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: reason.trim() || undefined,
          banDuration: action === "ban_and_delete" ? banDuration : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Ошибка");
      }
      onDone();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSending(false);
    }
  }

  const modal = (
    <div className="mod-dialog-overlay" onClick={onClose} role="presentation">
      <div className="mod-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="mod-dialog-title">Модерация комментария</h3>

        <div className="mod-dialog-field">
          <label className="mod-dialog-label" htmlFor={`mod-action-${commentId}`}>
            Действие
          </label>
          <select
            id={`mod-action-${commentId}`}
            className="mod-dialog-select"
            value={action}
            onChange={(e) => setAction(e.target.value as Action)}
          >
            <option value="delete_only">Удалить комментарий</option>
            <option value="warn_and_delete">Удалить и выписать предупреждение</option>
            <option value="ban_and_delete">Удалить и заблокировать автора</option>
          </select>
        </div>

        {(action === "warn_and_delete" || action === "ban_and_delete") && (
          <div className="mod-dialog-field">
            <label className="mod-dialog-label" htmlFor={`mod-reason-${commentId}`}>
              Причина (увидит пользователь)
            </label>
            <textarea
              id={`mod-reason-${commentId}`}
              className="mod-dialog-textarea"
              value={reason}
              maxLength={MAX_MODERATION_TEXT_CHARS}
              onChange={(e) => setReason(clampModerationText(e.target.value))}
              rows={3}
              placeholder="Кратко опишите нарушение"
            />
          </div>
        )}

        {action === "ban_and_delete" && (
          <div className="mod-dialog-field">
            <label className="mod-dialog-label" htmlFor={`mod-ban-${commentId}`}>
              Срок блокировки
            </label>
            <select
              id={`mod-ban-${commentId}`}
              className="mod-dialog-select"
              value={banDuration}
              onChange={(e) => setBanDuration(e.target.value as BanDurationKey)}
            >
              {ALL_BAN_DURATION_KEYS.map((k) => (
                <option key={k} value={k}>
                  {BAN_DURATION_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        )}

        {error ? <div className="mod-dialog-error">{error}</div> : null}

        <div className="mod-dialog-actions">
          <button type="button" className="mod-dialog-btn secondary" onClick={onClose} disabled={sending}>
            Отмена
          </button>
          <button type="button" className="mod-dialog-btn primary" onClick={() => void submit()} disabled={sending}>
            {sending ? "…" : "Применить"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(modal, document.body);
}
