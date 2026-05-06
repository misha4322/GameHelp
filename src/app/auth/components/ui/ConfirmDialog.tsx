"use client";

import { useEffect } from "react";

import "./ConfirmDialog.css";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Если не передать — блок с текстом не показывается */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger — красная кнопка подтверждения */
  variant?: "danger" | "neutral";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  variant = "neutral",
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
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

  if (!open) return null;

  const hasMessage = Boolean(message?.trim());

  return (
    <div
      className="confirm-dialog-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        {...(hasMessage ? { "aria-describedby": "confirm-dialog-desc" } : {})}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="confirm-dialog-title">
          {title}
        </h2>
        {hasMessage ? (
          <p id="confirm-dialog-desc" className="confirm-dialog-message">
            {message}
          </p>
        ) : null}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn cancel"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog-btn confirm ${variant === "danger" ? "danger" : ""}`}
            onClick={() => void onConfirm()}
            disabled={loading}
          >
            {loading ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
