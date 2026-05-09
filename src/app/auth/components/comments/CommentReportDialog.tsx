"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { COMMENT_REPORT_PRESETS } from "@/lib/comment-report-labels";
import { clampModerationText, MAX_MODERATION_TEXT_CHARS } from "@/lib/moderation-text-limit";
import type { CommentReportReasonCategory } from "@/server/db/schema";

import "./CommentReportDialog.css";

type Props = {
  open: boolean;
  commentId: string;
  userId: string | null;
  onClose: () => void;
  onSubmitted?: () => void;
};

export default function CommentReportDialog({
  open,
  commentId,
  userId,
  onClose,
  onSubmitted,
}: Props) {
  const [category, setCategory] = useState<CommentReportReasonCategory | null>(null);
  const [extraDetail, setExtraDetail] = useState("");
  const [customText, setCustomText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setCategory(null);
    setExtraDetail("");
    setCustomText("");
    setError("");
  }, [open, commentId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  const canSubmit =
    category &&
    (category !== "custom" || customText.trim().length >= 8);

  async function submit() {
    if (!category || !canSubmit) return;
    if (!userId) {
      setError("Сначала войди в аккаунт");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(commentId)}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          category,
          extraDetail: category !== "custom" ? extraDetail : "",
          customText: category === "custom" ? customText : "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Не удалось отправить");
      }
      onSubmitted?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="comment-report-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="comment-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comment-report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="comment-report-title" className="comment-report-title">
          Жалоба на комментарий
        </h2>
        <p className="comment-report-intro">
          Выберите причину: раскройте пункт и при необходимости уточните текстом.
        </p>

        <div className="comment-report-list">
          {COMMENT_REPORT_PRESETS.map((p) => (
            <details key={p.id} className="comment-report-details">
              <summary className="comment-report-summary">{p.title}</summary>
              <div className="comment-report-details-body">
                <p className="comment-report-desc">{p.description}</p>
                <label className="comment-report-label">
                  Уточнение (необязательно)
                  <textarea
                    className="comment-report-textarea"
                    rows={2}
                    maxLength={MAX_MODERATION_TEXT_CHARS}
                    placeholder="Дополнительный контекст для модераторов…"
                    value={category === p.id ? extraDetail : ""}
                    onChange={(e) => {
                      setCategory(p.id);
                      setExtraDetail(clampModerationText(e.target.value));
                    }}
                    disabled={loading}
                  />
                </label>
                <button
                  type="button"
                  className={`comment-report-pick ${category === p.id ? "active" : ""}`}
                  disabled={loading}
                  onClick={() => setCategory(p.id)}
                >
                  Жалоба по этой причине
                </button>
              </div>
            </details>
          ))}
        </div>

        <div className="comment-report-divider-wrap" aria-hidden>
          <span className="comment-report-divider-line" />
          <span className="comment-report-divider-label">
            Если ни один пункт не подходит — напишите сами ниже
          </span>
          <span className="comment-report-divider-line" />
        </div>

        <details className="comment-report-details comment-report-details-custom">
          <summary className="comment-report-summary">Свой вариант (описание вручную)</summary>
          <div className="comment-report-details-body">
            <textarea
              className="comment-report-textarea"
              rows={5}
              maxLength={MAX_MODERATION_TEXT_CHARS}
              placeholder="Опишите, в чём нарушение…"
              value={category === "custom" ? customText : ""}
              onChange={(e) => {
                setCategory("custom");
                setCustomText(clampModerationText(e.target.value));
              }}
              disabled={loading}
            />
            {category === "custom" && customText.trim().length > 0 && customText.trim().length < 8 ? (
              <p className="comment-report-warn">Нужно не меньше 8 символов.</p>
            ) : null}
            <button
              type="button"
              className={`comment-report-pick ${category === "custom" ? "active" : ""}`}
              disabled={loading}
              onClick={() => setCategory("custom")}
            >
              Отправить как «свой вариант»
            </button>
          </div>
        </details>

        {error ? <div className="comment-report-error">{error}</div> : null}

        <div className="comment-report-actions">
          <button type="button" className="comment-report-btn cancel" onClick={onClose} disabled={loading}>
            Отмена
          </button>
          <button
            type="button"
            className="comment-report-btn submit"
            disabled={loading || !canSubmit}
            onClick={() => void submit()}
          >
            {loading ? "Отправка…" : "Отправить жалобу"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
