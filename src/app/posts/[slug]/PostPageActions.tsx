"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { clampModerationText, MAX_MODERATION_TEXT_CHARS } from "@/lib/moderation-text-limit";
import { isStaffRole } from "@/lib/roles";

import styles from "./PostPageActions.module.css";

export default function PostPageActions({
  slug,
  title,
  authorId,
  viewerId,
  viewerRole = "user",
}: {
  slug: string;
  title: string;
  authorId: string | null | undefined;
  viewerId: string | null;
  viewerRole?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"delete" | "report" | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");

  const isAuthor = viewerId && authorId && viewerId === authorId;
  const isStaff = isStaffRole(viewerRole);
  const modPanelHref = `/admin?tab=moderation&openPost=${encodeURIComponent(slug)}`;

  async function reportPost() {
    if (!viewerId) {
      window.location.href = "/auth/login";
      return;
    }
    setBusy("report");
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(slug)}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: viewerId,
          reason: reportText.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Не удалось отправить жалобу");
      }
      setReportOpen(false);
      setReportText("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function deletePost() {
    if (!viewerId) return;
    if (!window.confirm(`Удалить публикацию «${title}»? Это нельзя отменить.`)) return;
    setBusy("delete");
    try {
      const res = await fetch(
        `/api/posts/${encodeURIComponent(slug)}?userId=${encodeURIComponent(viewerId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Не удалось удалить");
      }
      router.push("/posts");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  if (!viewerId) {
    return null;
  }

  if (isAuthor) {
    return (
      <div className={styles.wrap}>
        <div className={styles.row}>
          <Link href={`/posts/${encodeURIComponent(slug)}/edit`} className={styles.btnPrimary}>
            Редактировать
          </Link>
          <button
            type="button"
            className={styles.btnDanger}
            onClick={() => void deletePost()}
            disabled={busy === "delete"}
          >
            {busy === "delete" ? "Удаление…" : "Удалить пост"}
          </button>
          {isStaff ? (
            <Link href={modPanelHref} className={styles.staffMod}>
              Модерация поста
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {isStaff ? (
          <Link href={modPanelHref} className={styles.staffMod}>
            Модерация поста
          </Link>
        ) : (
          <button
            type="button"
            className={styles.warn}
            onClick={() => setReportOpen(true)}
            disabled={busy !== null}
          >
            Модерация
          </button>
        )}
      </div>

      {reportOpen ? (
        <div
          className={styles.reportOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Жалоба на пост"
        >
          <div className={styles.reportBox}>
            <h3 className={styles.reportTitle}>Жалоба на публикацию</h3>
            <p className={styles.reportHint}>
              «{title}» — кратко опиши, что не так (по желанию).
            </p>
            <textarea
              className={styles.reportTextarea}
              value={reportText}
              maxLength={MAX_MODERATION_TEXT_CHARS}
              onChange={(e) => setReportText(clampModerationText(e.target.value))}
              placeholder="Пам или спам, оскорбления…"
              rows={4}
            />
            <div className={styles.reportActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => {
                  setReportOpen(false);
                  setReportText("");
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                className={styles.btnWarn}
                disabled={busy === "report"}
                onClick={() => void reportPost()}
              >
                {busy === "report" ? "Отправка…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
