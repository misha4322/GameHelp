"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ALL_BAN_DURATION_KEYS,
  BAN_DURATION_LABELS,
  type BanDurationKey,
  isBanDurationKey,
} from "@/lib/ban-durations";
import { markdownPostFragmentToHtml } from "@/lib/markdown-admin-preview";
import { clampModerationText, MAX_MODERATION_TEXT_CHARS } from "@/lib/moderation-text-limit";
import { BAN_IMMUNE_MESSAGE, isBanImmuneRole } from "@/lib/roles";

/** Передаётся в onDone после успешного действия — родитель обновляет списки и анимирует панель модерации. */
export type ReportReviewDonePayload = {
  /** Удалить одну заявку из «Очередь жалоб» */
  removeReportById?: string;
  /** Пост удалён на сервере — убрать из сетки модерации после анимации */
  deletedPostId?: string;
  /** Свернуть нижнюю панель поста (запрос правок / сняли жалобу с поста) */
  clearModerationDetailForPostId?: string;
  /** После запроса правок API снимает жалобы с поста — убрать из очереди локально */
  clearReportsForPostId?: string;
};

export type ModerationReportDto = {
  id: string;
  queueItem?: boolean;
  targetType: string;
  targetId: string;
  reasonCategory: string | null;
  reasonCategoryLabel: string | null;
  reason: string | null;
  createdAt: string | null;
  reporter: { id: string; username: string };
  commentAuthor: { id: string; username: string; role?: string } | null;
  reportsAgainstCommentAuthor: number | null;
  commentContext: {
    postSlug: string | null;
    postTitle: string | null;
    preview: string | null;
  } | null;
  postContext: {
    postId: string;
    slug: string;
    title: string;
    author: { id: string; username: string; role?: string };
    contentPreview: string | null;
  } | null;
};

type Props = {
  report: ModerationReportDto | null;
  onClose: () => void;
  onDone: (payload?: ReportReviewDonePayload) => void;
};

type BusyPhase =
  | null
  | "del"
  | "del-done"
  | "dismiss"
  | "dismiss-done"
  | "ban"
  | "revise"
  | "revise-done";

type BanDurationChoice = BanDurationKey | "off";

export default function ReportReviewDrawer({ report, onClose, onDone }: Props) {
  const [busy, setBusy] = useState<BusyPhase>(null);
  const [err, setErr] = useState("");
  const [banDuration, setBanDuration] = useState<BanDurationChoice>("off");
  const [notifyReason, setNotifyReason] = useState("");

  useEffect(() => {
    setBusy(null);
    setErr("");
    setBanDuration("off");
    setNotifyReason("");
  }, [report?.targetId, report?.id]);

  if (!report) return null;

  const isQueueItem = report.queueItem !== false;
  const isComment = report.targetType === "comment";
  const isPost = report.targetType === "post";
  const postSlug = report.postContext?.slug ?? null;

  const commentAuthorId = report.commentAuthor?.id;
  const postAuthorId = report.postContext?.author.id;
  const banTargetId = isComment ? commentAuthorId : postAuthorId;
  const banTargetRole = isComment
    ? report.commentAuthor?.role
    : report.postContext?.author.role;
  const banImmune = isBanImmuneRole(banTargetRole);

  const blockingOverlay =
    busy === "del" ||
    busy === "del-done" ||
    busy === "dismiss" ||
    busy === "dismiss-done" ||
    busy === "ban" ||
    busy === "revise" ||
    busy === "revise-done";

  async function dismiss() {
    if (!report || !isQueueItem || !report.id) return;
    setBusy("dismiss");
    setErr("");
    try {
      const res = await fetch(`/api/admin/reports/${encodeURIComponent(report.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setBusy("dismiss-done");
      window.setTimeout(() => {
        onDone({
          removeReportById: report.id || undefined,
          clearModerationDetailForPostId:
            isPost && report.postContext ? report.postContext.postId : undefined,
        });
        onClose();
      }, 650);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBusy(null);
    }
  }

  async function deleteComment() {
    if (!report || !isComment) return;
    setBusy("del");
    setErr("");
    const shouldBanAfter = !!commentAuthorId && banDuration !== "off";
    try {
      const res = await fetch(`/api/admin/comments/${encodeURIComponent(report.targetId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");

      if (shouldBanAfter) {
        setBusy("ban");
        const banRes = await fetch(`/api/admin/users/${encodeURIComponent(commentAuthorId)}/timed-ban`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration: banDuration,
            notifyReason: notifyReason.trim() || undefined,
          }),
        });
        const banData = await banRes.json().catch(() => ({}));
        if (!banRes.ok) {
          setErr(
            typeof banData.error === "string"
              ? `Комментарий удалён, но блокировка не применилась: ${banData.error}`
              : "Комментарий удалён, но блокировка не применилась."
          );
          setBusy(null);
          onDone({ removeReportById: report.id || undefined });
          return;
        }
      }

      setBusy("del-done");
      window.setTimeout(() => {
        onDone({ removeReportById: report.id || undefined });
        onClose();
      }, 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBusy(null);
    }
  }

  async function deleteReportedPost() {
    if (!report || !isPost) return;
    setBusy("del");
    setErr("");
    const shouldBanAfter = !!postAuthorId && banDuration !== "off";
    try {
      const res = await fetch(`/api/admin/posts/${encodeURIComponent(report.targetId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");

      if (shouldBanAfter) {
        setBusy("ban");
        const banRes = await fetch(`/api/admin/users/${encodeURIComponent(postAuthorId)}/timed-ban`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration: banDuration,
            notifyReason: notifyReason.trim() || undefined,
          }),
        });
        const banData = await banRes.json().catch(() => ({}));
        if (!banRes.ok) {
          setErr(
            typeof banData.error === "string"
              ? `Пост удалён, но блокировка не применилась: ${banData.error}`
              : "Пост удалён, но блокировка не применилась."
          );
          setBusy(null);
          onDone({
            deletedPostId: report.targetId,
            removeReportById: report.id || undefined,
            clearReportsForPostId: report.targetId,
          });
          return;
        }
      }

      setBusy("del-done");
      window.setTimeout(() => {
        onDone({
          deletedPostId: report.targetId,
          removeReportById: report.id || undefined,
          clearReportsForPostId: report.targetId,
        });
        onClose();
      }, 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBusy(null);
    }
  }

  async function requestPostRevision() {
    if (!report || !isPost) return;
    setBusy("revise");
    setErr("");
    try {
      const res = await fetch(
        `/api/admin/posts/${encodeURIComponent(report.targetId)}/request-revision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setBusy("revise-done");
      window.setTimeout(() => {
        onDone({
          clearModerationDetailForPostId: report.targetId,
          clearReportsForPostId: report.targetId,
        });
        onClose();
      }, 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBusy(null);
    }
  }

  async function timedBanAuthor() {
    if (!banTargetId || banDuration === "off" || !isBanDurationKey(banDuration) || banImmune) return;
    setBusy("ban");
    setErr("");
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(banTargetId)}/timed-ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration: banDuration,
          notifyReason: notifyReason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  const drawerTitle = isPost
    ? isQueueItem
      ? "Жалоба на пост"
      : "Модерация поста"
    : isQueueItem
      ? "Разбор жалобы"
      : "Модерация комментария";

  const drawerAria = drawerTitle;

  return (
    <div
      className="report-drawer-overlay"
      role="presentation"
      onClick={() => !blockingOverlay && onClose()}
    >
      <aside
        className={`report-drawer ${blockingOverlay ? "report-drawer-animating" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={drawerAria}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="report-drawer-head">
          <h3 className="report-drawer-title">{drawerTitle}</h3>
          <button
            type="button"
            className="report-drawer-close"
            onClick={() => !blockingOverlay && onClose()}
            aria-label="Закрыть"
            disabled={!!blockingOverlay}
          >
            ×
          </button>
        </div>

        <div className="report-drawer-body report-drawer-body-relative">
          {blockingOverlay ? (
            <div className="report-drawer-busy" aria-live="polite">
              {busy === "del" ? (
                <>
                  <div className="report-drawer-spinner" />
                  <p className="report-drawer-busy-text">
                    {isPost ? "Удаление поста…" : "Удаление комментария…"}
                  </p>
                  <p className="report-drawer-busy-sub">
                    {isPost
                      ? "Жалобы на пост снимаются с очереди."
                      : "Жалобы на комментарий снимаются автоматически."}
                  </p>
                </>
              ) : null}
              {busy === "revise" ? (
                <>
                  <div className="report-drawer-spinner" />
                  <p className="report-drawer-busy-text">Запрос автору…</p>
                  <p className="report-drawer-busy-sub">
                    У автора появится плашка со ссылкой на редактор поста.
                  </p>
                </>
              ) : null}
              {busy === "dismiss" ? (
                <>
                  <div className="report-drawer-spinner" />
                  <p className="report-drawer-busy-text">Снятие с очереди…</p>
                  <p className="report-drawer-busy-sub">Подождите секунду.</p>
                </>
              ) : null}
              {busy === "del-done" ? (
                <>
                  <div className="report-drawer-done-icon" aria-hidden>
                    ✓
                  </div>
                  <p className="report-drawer-busy-text">{isPost ? "Пост удалён" : "Комментарий удалён"}</p>
                  <p className="report-drawer-busy-sub">Очередь обновляется…</p>
                </>
              ) : null}
              {busy === "revise-done" ? (
                <>
                  <div className="report-drawer-done-icon" aria-hidden>
                    ✓
                  </div>
                  <p className="report-drawer-busy-text">Запрос отправлен</p>
                  <p className="report-drawer-busy-sub">Автор сможет открыть пост в редакторе из плашки.</p>
                </>
              ) : null}
              {busy === "dismiss-done" ? (
                <>
                  <div className="report-drawer-done-icon" aria-hidden>
                    ✓
                  </div>
                  <p className="report-drawer-busy-text">Жалоба снята</p>
                  <p className="report-drawer-busy-sub">Очередь обновляется…</p>
                </>
              ) : null}
              {busy === "ban" ? (
                <>
                  <div className="report-drawer-spinner" />
                  <p className="report-drawer-busy-text">Блокировка автора…</p>
                  <p className="report-drawer-busy-sub">Подождите секунду.</p>
                </>
              ) : null}
            </div>
          ) : null}

          <div className={blockingOverlay ? "report-drawer-content-dimmed" : undefined}>
            <section className="report-drawer-section">
              <h4 className="report-drawer-section-title">Сводка</h4>
              <div className="report-drawer-meta">
                <div>
                  <span className="report-drawer-k">Дата</span>{" "}
                  {report.createdAt ? new Date(report.createdAt).toLocaleString("ru-RU") : "—"}
                </div>
                <div>
                  <span className="report-drawer-k">Заявитель</span>{" "}
                  {isQueueItem ? report.reporter.username : "— (прямой разбор)"}
                </div>
                <div>
                  <span className="report-drawer-k">Тип</span>{" "}
                  {isComment ? "Комментарий" : isPost ? "Пост" : "Сообщение"}
                </div>
                {(report.reasonCategoryLabel || report.reasonCategory) && (
                  <div>
                    <span className="report-drawer-k">Категория</span>{" "}
                    {report.reasonCategoryLabel ?? report.reasonCategory}
                  </div>
                )}
              </div>
            </section>

            {isComment && report.commentAuthor ? (
              <section className="report-drawer-section">
                <h4 className="report-drawer-section-title">Автор комментария</h4>
                <div className="report-drawer-author">
                  <Link href={`/u/${report.commentAuthor.id}`} className="admin-link">
                    {report.commentAuthor.username}
                  </Link>
                  {typeof report.reportsAgainstCommentAuthor === "number" ? (
                    <span className="report-drawer-author-stats">
                      {" "}
                      · жалоб на его комментарии в очереди:{" "}
                      <strong>{report.reportsAgainstCommentAuthor}</strong>
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {isPost && report.postContext ? (
              <section className="report-drawer-section">
                <h4 className="report-drawer-section-title">Автор поста</h4>
                <div className="report-drawer-author">
                  <Link href={`/u/${report.postContext.author.id}`} className="admin-link">
                    {report.postContext.author.username}
                  </Link>
                </div>
              </section>
            ) : null}

            <section className="report-drawer-section">
              <h4 className="report-drawer-section-title">Контент и жалоба</h4>
              {report.commentContext?.postSlug ? (
                <div className="report-drawer-field">
                  <span className="report-drawer-k">Пост</span>{" "}
                  <Link
                    href={`/posts/${encodeURIComponent(report.commentContext.postSlug)}`}
                    className="admin-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {report.commentContext.postTitle ?? report.commentContext.postSlug}
                  </Link>
                </div>
              ) : null}
              {postSlug ? (
                <div className="report-drawer-field">
                  <span className="report-drawer-k">Пост</span>{" "}
                  <Link
                    href={`/posts/${encodeURIComponent(postSlug)}`}
                    className="admin-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {report.postContext?.title ?? postSlug}
                  </Link>
                </div>
              ) : null}
              {report.commentContext?.preview ? (
                <div className="report-drawer-field">
                  <span className="report-drawer-k">Комментарий</span>
                  <div
                    className="report-drawer-preview report-drawer-preview-rich"
                    dangerouslySetInnerHTML={{
                      __html: markdownPostFragmentToHtml(report.commentContext.preview),
                    }}
                  />
                </div>
              ) : null}
              {report.postContext?.contentPreview ? (
                <div className="report-drawer-field">
                  <span className="report-drawer-k">Текст поста (фрагмент)</span>
                  <div
                    className="report-drawer-preview report-drawer-preview-rich"
                    dangerouslySetInnerHTML={{
                      __html: markdownPostFragmentToHtml(report.postContext.contentPreview),
                    }}
                  />
                </div>
              ) : null}
              <div className="report-drawer-field">
                <span className="report-drawer-k">{isQueueItem ? "Текст жалобы" : "Примечание"}</span>
                <pre className="report-drawer-preview">{report.reason ?? "—"}</pre>
              </div>
            </section>

            {isComment ? (
              <section className="report-drawer-section">
                <h4 className="report-drawer-section-title">Действия с комментарием</h4>
                <div className="report-drawer-actions report-drawer-actions-stack">
                  {report.commentContext?.postSlug ? (
                    <a
                      className="btn btn-ghost"
                      href={`/posts/${encodeURIComponent(report.commentContext.postSlug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Открыть пост
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!!blockingOverlay}
                    onClick={() => void deleteComment()}
                  >
                    Удалить комментарий
                  </button>
                </div>
                <p className="report-drawer-inline-hint">
                  Ниже выберите срок блокировки: при «Не банить» комментарий удалится без бана; иначе бан
                  применится вместе с удалением.
                </p>
              </section>
            ) : null}

            {isPost ? (
              <section className="report-drawer-section">
                <h4 className="report-drawer-section-title">Действия с постом</h4>
                <div className="report-drawer-actions report-drawer-actions-stack">
                  {postSlug ? (
                    <a
                      className="btn btn-ghost"
                      href={`/posts/${encodeURIComponent(postSlug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Открыть пост на сайте
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!!blockingOverlay}
                    onClick={() => void deleteReportedPost()}
                  >
                    Удалить пост
                  </button>
                </div>
                <p className="report-drawer-inline-hint">
                  Срок блокировки ниже: при удалении поста бан автора применится автоматически, если выбран
                  срок отличный от «Не банить при удалении».
                </p>
              </section>
            ) : null}

            {isPost ? (
              <section className="report-drawer-section">
                <h4 className="report-drawer-section-title">Запрос правок у автора</h4>
                <p className="report-drawer-ban-hint">
                  У автора появится плашка со ссылкой на редактор. Жалобы на этот пост исчезнут из очереди.
                  После сохранения поста плашка снимется.
                </p>
                <button
                  type="button"
                  className="btn btn-primary report-drawer-full-btn"
                  disabled={!!blockingOverlay}
                  onClick={() => void requestPostRevision()}
                >
                  Запросить правки
                </button>
              </section>
            ) : null}

            {banTargetId ? (
              <section className="report-drawer-section">
                <h4 className="report-drawer-section-title">
                  {isPost ? "Блокировка автора поста" : "Блокировка автора комментария"}
                </h4>
                {banImmune ? (
                  <p className="report-drawer-inline-hint report-drawer-inline-hint-warn">{BAN_IMMUNE_MESSAGE}</p>
                ) : (
                  <>
                    <p className="report-drawer-ban-hint">
                      Выберите срок и нажмите «Забанить», чтобы применить блокировку без удаления{" "}
                      {isPost ? "поста" : "комментария"} (или оставьте только удаление — см. выше).
                    </p>
                    <div className="report-drawer-ban-row">
                      <select
                        className="admin-input"
                        value={banDuration}
                        onChange={(e) => setBanDuration(e.target.value as BanDurationChoice)}
                        disabled={!!blockingOverlay}
                      >
                        <option value="off">Не банить при удалении</option>
                        {ALL_BAN_DURATION_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {BAN_DURATION_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary report-drawer-ban-btn"
                        disabled={!!blockingOverlay || banDuration === "off"}
                        onClick={() => void timedBanAuthor()}
                      >
                        {busy === "ban" ? "…" : "Забанить автора"}
                      </button>
                    </div>
                    <label className="report-drawer-label">
                      Сообщение пользователю (необязательно, до {MAX_MODERATION_TEXT_CHARS} символов)
                      <textarea
                        className="admin-input"
                        rows={3}
                        maxLength={MAX_MODERATION_TEXT_CHARS}
                        value={notifyReason}
                        onChange={(e) => setNotifyReason(clampModerationText(e.target.value))}
                        placeholder="Увидит в уведомлении к блокировке"
                        disabled={!!blockingOverlay}
                      />
                    </label>
                  </>
                )}
              </section>
            ) : null}

            {err ? <div className="report-drawer-error">{err}</div> : null}

            {isQueueItem && report.id ? (
              <section className="report-drawer-section report-drawer-section-footer">
                <h4 className="report-drawer-section-title">Очередь</h4>
                <p className="report-drawer-footer-hint">
                  Если жалоба необоснованная — снимите её с очереди без удаления контента.
                </p>
                <button
                  type="button"
                  className="btn btn-ghost report-drawer-full-btn"
                  disabled={!!blockingOverlay}
                  onClick={() => void dismiss()}
                >
                  Убрать жалобу из очереди
                </button>
              </section>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
