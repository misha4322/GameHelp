"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import ReportReviewDrawer, {
  type ModerationReportDto,
  type ReportReviewDonePayload,
} from "./ReportReviewDrawer";
import AdminTagsPanel from "./AdminTagsPanel";
import { maskModerationPhrase } from "@/lib/moderation/normalize";

type Row = {
  id: string;
  username: string;
  email: string | null;
  role: string;
  isBanned: boolean;
  createdAt: string | null;
};

type Stats = {
  users: number;
  posts: number;
  admins: number;
  bannedUsers: number;
  chiefAdminId?: string | null;
};
type AdminPost = {
  id: string;
  slug: string;
  title: string;
  createdAt: string | null;
  coverImage?: string | null;
  author?: { username?: string | null } | null;
};

type AdminReportRow = ModerationReportDto;

export type AdminTabKey = "users" | "moderation" | "reports" | "tags" | "censorship";

type ModerationWordRow = {
  id: string;
  phrase: string | null;
  maskedPhrase: string;
  action: "censor" | "block";
  scope: "all" | "posts" | "comments" | "messages" | "profile";
  severity: "low" | "medium" | "high";
  replacement: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

function moderationSeverityRu(s: string) {
  if (s === "low") return "Низкая";
  if (s === "medium") return "Средняя";
  if (s === "high") return "Высокая";
  return "—";
}

export function AdminClient({
  isAdmin,
  canUseDictionaryTabs,
  myId,
  initialOpenCommentId,
  initialOpenPostSlug,
  initialTab = "users",
}: {
  isAdmin: boolean;
  /** Словарь цензуры и теги форума — только admin (не moderator). */
  canUseDictionaryTabs: boolean;
  myId: string;
  initialOpenCommentId?: string | null;
  initialOpenPostSlug?: string | null;
  initialTab?: AdminTabKey;
}) {
  const { update } = useSession();
  const [activeTab, setActiveTab] = useState<AdminTabKey>(
    (initialTab === "tags" || initialTab === "censorship") && !canUseDictionaryTabs ? "users" : initialTab
  );
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [usersPageSize, setUsersPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState("");
  const [qActive, setQActive] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [postsList, setPostsList] = useState<AdminPost[]>([]);
  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportDrawer, setReportDrawer] = useState<ModerationReportDto | null>(null);
  const [moderationFocus, setModerationFocus] = useState<AdminPost | null>(null);
  /** После действий в drawer: анимация исчезновения карточки/панели поста */
  const [moderationClosing, setModerationClosing] = useState<{
    postId: string;
    dropFromGrid: boolean;
  } | null>(null);
  const [moderationToast, setModerationToast] = useState("");

  const [wordsLoading, setWordsLoading] = useState(false);
  const [words, setWords] = useState<ModerationWordRow[]>([]);
  const [wordsErr, setWordsErr] = useState("");
  const [wordFormMode, setWordFormMode] = useState<"create" | "edit">("create");
  const [wordEditingId, setWordEditingId] = useState<string | null>(null);
  const [wordPhrase, setWordPhrase] = useState("");
  const [wordRevealInput, setWordRevealInput] = useState(false);
  const [wordAction, setWordAction] = useState<"censor" | "block">("censor");
  const [wordScope, setWordScope] = useState<
    "all" | "posts" | "comments" | "messages" | "profile"
  >("all");
  const [wordSeverity, setWordSeverity] = useState<"low" | "medium" | "high">("medium");
  const [wordReplacement, setWordReplacement] = useState("***");
  const [revealedPhraseById, setRevealedPhraseById] = useState<Record<string, string>>({});
  const [wordsShowUncensored, setWordsShowUncensored] = useState(false);
  const [bulkPhrasesRaw, setBulkPhrasesRaw] = useState("");
  const [bulkResult, setBulkResult] = useState<string>("");

  const [listEpoch, setListEpoch] = useState(0);
  const postsListRef = useRef<AdminPost[]>([]);
  postsListRef.current = postsList;

  useEffect(() => {
    if (!moderationToast) return;
    const t = window.setTimeout(() => setModerationToast(""), 4500);
    return () => window.clearTimeout(t);
  }, [moderationToast]);

  const applyPostModerationPayload = useCallback((data: { report?: ModerationReportDto }) => {
    const r = data.report;
    if (!r?.postContext) return;
    setActiveTab("moderation");
    const list = postsListRef.current;
    const fromList = list.find(
      (p) => p.id === r.postContext!.postId || p.slug === r.postContext!.slug
    );
    setModerationFocus(
      fromList ?? {
        id: r.postContext.postId,
        slug: r.postContext.slug,
        title: r.postContext.title,
        createdAt: null,
        coverImage: null,
        author: r.postContext.author,
      }
    );
    setReportDrawer(r);
    window.history.replaceState(null, "", "/admin?tab=moderation");
    window.setTimeout(() => {
      document.getElementById("admin-section-moderation")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }, []);

  const openPostModerationFromSlug = useCallback(
    async (slug: string) => {
      const s = slug?.trim();
      if (!s) return;
      setErr("");
      try {
        const res = await fetch(`/api/admin/moderation/by-post/${encodeURIComponent(s)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as { report?: ModerationReportDto; error?: string };
        if (!res.ok) throw new Error(data.error || "Не удалось открыть модерацию");
        if (!data.report) throw new Error("Нет данных");
        applyPostModerationPayload(data);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Ошибка");
      }
    },
    [applyPostModerationPayload]
  );

  useEffect(() => {
    const cid = initialOpenCommentId?.trim();
    const pid = initialOpenPostSlug?.trim();
    if (!cid && !pid) return;
    const ac = new AbortController();
    void (async () => {
      try {
        if (cid) {
          const res = await fetch(`/api/admin/moderation/by-comment/${encodeURIComponent(cid)}`, {
            cache: "no-store",
            signal: ac.signal,
          });
          if (!res.ok || ac.signal.aborted) return;
          const data = (await res.json().catch(() => ({}))) as { report?: ModerationReportDto };
          if (!data.report || ac.signal.aborted) return;
          setActiveTab("reports");
          setReportDrawer(data.report);
          window.history.replaceState(null, "", "/admin?tab=reports");
          window.setTimeout(() => {
            document.getElementById("admin-section-reports")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }, 80);
          return;
        }

        const res = await fetch(`/api/admin/moderation/by-post/${encodeURIComponent(pid!)}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!res.ok || ac.signal.aborted) return;
        const data = (await res.json().catch(() => ({}))) as { report?: ModerationReportDto };
        if (!data.report || ac.signal.aborted) return;
        applyPostModerationPayload(data);
      } catch {
        /* aborted or network */
      }
    })();
    return () => ac.abort();
  }, [initialOpenCommentId, initialOpenPostSlug, applyPostModerationPayload]);

  useEffect(() => {
    if (!moderationFocus?.slug) return;
    const richer = postsList.find(
      (p) => p.slug === moderationFocus.slug || p.id === moderationFocus.id
    );
    if (richer?.coverImage && !moderationFocus.coverImage) {
      setModerationFocus(richer);
    }
  }, [postsList, moderationFocus?.slug, moderationFocus?.id, moderationFocus?.coverImage]);

  function goTab(tab: AdminTabKey) {
    if ((tab === "censorship" || tab === "tags") && !canUseDictionaryTabs) return;
    setActiveTab(tab);
    const sp = new URLSearchParams(window.location.search);
    sp.set("tab", tab);
    sp.delete("openComment");
    sp.delete("openPost");
    const q = sp.toString();
    window.history.replaceState(null, "", q ? `/admin?${q}` : "/admin");
  }

  const runSearch = () => {
    setQActive(qInput.trim());
    setPage(1);
    setListEpoch((n) => n + 1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const sp = new URLSearchParams({ page: String(page) });
      if (qActive) sp.set("q", qActive);
      const [sRes, uRes] = await Promise.all([
        fetch("/api/admin/stats", { cache: "no-store" }),
        fetch(`/api/admin/users?${sp}`, { cache: "no-store" }),
      ]);
      if (!sRes.ok) throw new Error("stats");
      if (!uRes.ok) throw new Error("users");
      setStats((await sRes.json()) as Stats);
      const uj = (await uRes.json()) as { users: Row[]; total: number; pageSize?: number };
      setUsers(uj.users);
      setTotal(uj.total);
      setUsersPageSize(
        typeof uj.pageSize === "number" && uj.pageSize > 0 ? uj.pageSize : 10
      );
      const next: Record<string, string> = {};
      for (const u of uj.users) next[u.id] = u.role;
      setRoleDraft(next);
    } catch {
      setErr("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [page, qActive]);

  useEffect(() => {
    void load();
  }, [load, listEpoch]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/posts", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { posts?: AdminPost[] };
        setPostsList(Array.isArray(data.posts) ? data.posts.slice(0, 48) : []);
      } catch {
        // no-op
      }
    })();
  }, [listEpoch]);

  useEffect(() => {
    void (async () => {
      setReportsLoading(true);
      try {
        const res = await fetch("/api/admin/reports?limit=80", { cache: "no-store" });
        if (!res.ok) {
          setReports([]);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { reports?: AdminReportRow[] };
        setReports(Array.isArray(data.reports) ? data.reports : []);
      } catch {
        setReports([]);
      } finally {
        setReportsLoading(false);
      }
    })();
  }, [listEpoch]);

  function refresh() {
    setListEpoch((n) => n + 1);
  }

  const loadWords = useCallback(async () => {
    if (!canUseDictionaryTabs) return;
    setWordsLoading(true);
    setWordsErr("");
    try {
      const sp = new URLSearchParams({ userId: myId });
      if (wordsShowUncensored) sp.set("reveal", "true");
      const res = await fetch(`/api/moderation/words?${sp}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        words?: ModerationWordRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить словарь");
      setWords(Array.isArray(data.words) ? data.words : []);
    } catch (e) {
      setWords([]);
      setWordsErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setWordsLoading(false);
    }
  }, [canUseDictionaryTabs, myId, wordsShowUncensored]);

  useEffect(() => {
    if (activeTab !== "censorship") return;
    void loadWords();
  }, [activeTab, loadWords, listEpoch]);

  const handleReportDrawerDone = useCallback((p?: ReportReviewDonePayload) => {
    if (p?.removeReportById) {
      const rid = p.removeReportById;
      setReports((prev) => prev.filter((r) => r.id !== rid));
    }
    if (p?.clearReportsForPostId) {
      const pid = p.clearReportsForPostId;
      setReports((prev) => prev.filter((r) => !(r.targetType === "post" && r.targetId === pid)));
    }
    const closePostId = p?.deletedPostId ?? p?.clearModerationDetailForPostId;
    const dropFromGrid = Boolean(p?.deletedPostId);
    if (closePostId) {
      setModerationClosing({ postId: closePostId, dropFromGrid });
      window.setTimeout(() => {
        setModerationClosing(null);
        if (dropFromGrid && p?.deletedPostId) {
          setPostsList((prev) => prev.filter((x) => x.id !== p.deletedPostId));
        }
        setModerationFocus((f) => (f?.id === closePostId ? null : f));
      }, 400);
    }
    refresh();
  }, []);

  function resetWordForm() {
    setWordFormMode("create");
    setWordEditingId(null);
    setWordPhrase("");
    setWordRevealInput(false);
    setWordAction("censor");
    setWordScope("all");
    setWordSeverity("medium");
    setWordReplacement("***");
  }

  async function startEditWord(id: string) {
    if (!canUseDictionaryTabs) return;
    setWordsErr("");
    try {
      const sp = new URLSearchParams({ userId: myId });
      const res = await fetch(`/api/moderation/words/${encodeURIComponent(id)}?${sp}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { word?: ModerationWordRow; error?: string };
      if (!res.ok || !data.word) throw new Error(data.error || "Не удалось открыть правило");
      setWordFormMode("edit");
      setWordEditingId(id);
      setWordPhrase(data.word.phrase ?? "");
      setWordAction(data.word.action);
      setWordScope(data.word.scope);
      setWordSeverity(data.word.severity);
      setWordReplacement(data.word.replacement ?? "***");
      setWordRevealInput(true);
      setRevealedPhraseById((prev) => ({ ...prev, [id]: data.word!.phrase ?? "" }));
    } catch (e) {
      setWordsErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function toggleRevealPhrase(id: string) {
    if (!canUseDictionaryTabs) return;
    if (wordsShowUncensored) return;
    if (revealedPhraseById[id]) {
      setRevealedPhraseById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    await startEditWord(id);
  }

  async function submitWordForm() {
    if (!canUseDictionaryTabs) return;
    setSaving("words-form");
    setWordsErr("");
    try {
      const isActive =
        wordFormMode === "edit" && wordEditingId
          ? (words.find((w) => w.id === wordEditingId)?.isActive ?? true)
          : true;
      const payload = {
        userId: myId,
        phrase: wordPhrase,
        action: wordAction,
        scope: wordScope,
        severity: wordSeverity,
        replacement: wordReplacement,
        isActive,
      };

      const url =
        wordFormMode === "edit" && wordEditingId
          ? `/api/moderation/words/${encodeURIComponent(wordEditingId)}`
          : "/api/moderation/words";
      const method = wordFormMode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения");

      resetWordForm();
      refresh();
      setModerationToast("Правило цензуры сохранено.");
    } catch (e) {
      setWordsErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(null);
    }
  }

  async function submitBulkWords() {
    if (!canUseDictionaryTabs) return;
    const raw = bulkPhrasesRaw.trim();
    if (!raw) {
      setWordsErr("Вставьте список слов/фраз");
      return;
    }
    setSaving("words-bulk");
    setWordsErr("");
    setBulkResult("");
    try {
      const payload = {
        userId: myId,
        phrasesRaw: raw,
        action: wordAction,
        scope: wordScope,
        severity: wordSeverity,
        replacement: wordReplacement,
        isActive: true,
      };
      const res = await fetch("/api/moderation/words/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        received?: number;
        normalized?: number;
        inserted?: number;
        skippedExisting?: number;
      };
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки списка");
      setBulkPhrasesRaw("");
      setBulkResult(
        `Добавлено: ${Number(data.inserted ?? 0)} · Уже было: ${Number(
          data.skippedExisting ?? 0
        )} · Всего строк/слов: ${Number(data.received ?? 0)}`
      );
      refresh();
      setModerationToast("Список цензуры загружен пачкой.");
    } catch (e) {
      setWordsErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(null);
    }
  }

  async function deleteWord(id: string) {
    if (!canUseDictionaryTabs) return;
    if (!window.confirm("Удалить правило цензуры?")) return;
    setSaving(`words-del-${id}`);
    setWordsErr("");
    try {
      const sp = new URLSearchParams({ userId: myId });
      const res = await fetch(`/api/moderation/words/${encodeURIComponent(id)}?${sp}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка удаления");
      setRevealedPhraseById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      refresh();
    } catch (e) {
      setWordsErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(null);
    }
  }

  async function saveRole(userId: string) {
    const role = roleDraft[userId];
    if (!role) return;
    setSaving(userId);
    setErr("");
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      await update();
      refresh();
    } catch (e: any) {
      setErr(e?.message || "Ошибка смены роли");
    } finally {
      setSaving(null);
    }
  }

  async function setBanned(userId: string, banned: boolean) {
    setSaving(`ban-${userId}`);
    setErr("");
    const prevRow = users.find((x) => x.id === userId);
    setUsers((list) => list.map((u) => (u.id === userId ? { ...u, isBanned: banned } : u)));
    try {
      const res = await fetch(`/api/admin/users/${userId}/ban`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      refresh();
    } catch (e: any) {
      setErr(e?.message || "Ошибка");
      if (prevRow) {
        setUsers((list) =>
          list.map((u) => (u.id === userId ? { ...u, isBanned: prevRow.isBanned } : u))
        );
      } else {
        refresh();
      }
    } finally {
      setSaving(null);
    }
  }

  async function deletePostById(post: AdminPost) {
    if (!window.confirm(`Удалить пост «${post.title}»?`)) return;
    setSaving(`delete-post-${post.id}`);
    setErr("");
    try {
      const res = await fetch(`/api/admin/posts/${encodeURIComponent(post.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка удаления");
      setModerationClosing({ postId: post.id, dropFromGrid: true });
      window.setTimeout(() => {
        setModerationClosing(null);
        setPostsList((prev) => prev.filter((x) => x.id !== post.id));
        setModerationFocus((f) => (f?.id === post.id ? null : f));
      }, 400);
      refresh();
    } catch (e: any) {
      setErr(e?.message || "Ошибка удаления поста");
    } finally {
      setSaving(null);
    }
  }

  async function copyPostForAdminReview(post: AdminPost) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const line = `Пост на рассмотрение: ${post.title}\n${origin}/posts/${post.slug}`;
    try {
      await navigator.clipboard.writeText(line);
      setModerationToast("Текст скопирован в буфер — можно вставить админу или в заметки.");
    } catch {
      setErr("Не удалось скопировать в буфер обмена");
    }
  }

  const pages = Math.max(1, Math.ceil(total / usersPageSize));
  const pageStart = total === 0 ? 0 : (page - 1) * usersPageSize + 1;
  const pageEnd = Math.min(page * usersPageSize, total);

  const chiefAdminId = stats?.chiefAdminId ?? null;

  return (
    <>
      {err ? <div className="admin-alert">{err}</div> : null}

      <nav className="admin-tabs" aria-label="Разделы админки">
        <button
          type="button"
          className={`admin-tab ${activeTab === "users" ? "admin-tab-active" : ""}`}
          onClick={() => goTab("users")}
        >
          Пользователи
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "moderation" ? "admin-tab-active" : ""}`}
          onClick={() => goTab("moderation")}
        >
          Модерация контента
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "reports" ? "admin-tab-active" : ""}`}
          onClick={() => goTab("reports")}
        >
          Очередь жалоб
          {reports.length > 0 ? <span className="admin-tab-badge">{reports.length}</span> : null}
        </button>
        {canUseDictionaryTabs ? (
          <button
            type="button"
            className={`admin-tab ${activeTab === "censorship" ? "admin-tab-active" : ""}`}
            onClick={() => goTab("censorship")}
          >
            Цензура
          </button>
        ) : null}
        {canUseDictionaryTabs ? (
          <button
            type="button"
            className={`admin-tab ${activeTab === "tags" ? "admin-tab-active" : ""}`}
            onClick={() => goTab("tags")}
          >
            Теги
          </button>
        ) : null}
      </nav>

      {stats ? (
        <div className="admin-stats">
          <div className="admin-stat">
            <span className="admin-stat-n">{stats.users}</span>
            <span className="admin-stat-l">пользователей</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-n">{stats.posts}</span>
            <span className="admin-stat-l">постов</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-n">{stats.admins}</span>
            <span className="admin-stat-l">админов</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-n">{stats.bannedUsers}</span>
            <span className="admin-stat-l">в бане</span>
          </div>
        </div>
      ) : null}

      {activeTab === "reports" ? (
      <section className="admin-card" id="admin-section-reports">
        <h2 className="admin-h2">Очередь жалоб</h2>
        <p className="admin-hint">
          Порядок: сначала старые заявки. Жалобы на комментарии и на посты. По карточке — панель: открыть
          пост, удалить контент или попросить автора поста переработать материал (у автора появится плашка
          со ссылкой на редактор). «Без удаления» — снять необоснованную жалобу.
        </p>
        {reportsLoading ? (
          <p className="admin-muted">Загрузка…</p>
        ) : reports.length === 0 ? (
          <p className="admin-muted">Пока нет жалоб.</p>
        ) : (
          <div className="admin-report-cards">
            {reports.map((r) => {
              const typeLabel =
                r.targetType === "comment"
                  ? "Комментарий"
                  : r.targetType === "post"
                    ? "Пост"
                    : "Сообщение";
              const excerpt =
                (r.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 140) ||
                r.postContext?.contentPreview?.replace(/\s+/g, " ").trim().slice(0, 140) ||
                r.commentContext?.preview?.slice(0, 140) ||
                "—";
              return (
                <button
                  key={r.id}
                  type="button"
                  className="admin-report-card"
                  onClick={() => setReportDrawer(r)}
                >
                  <div className="admin-report-card-top">
                    <span className="admin-report-card-date">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleString("ru-RU", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
                    <span className="admin-report-card-type">{typeLabel}</span>
                  </div>
                  <div className="admin-report-card-meta">
                    От <strong>{r.reporter.username}</strong>
                    {r.reasonCategoryLabel ? (
                      <>
                        {" · "}
                        <span className="admin-muted">{r.reasonCategoryLabel}</span>
                      </>
                    ) : null}
                  </div>
                  {r.targetType === "comment" && r.commentAuthor ? (
                    <div className="admin-report-card-author admin-muted">
                      Автор комментария: <strong>{r.commentAuthor.username}</strong>
                      {typeof r.reportsAgainstCommentAuthor === "number" ? (
                        <>
                          {" "}
                          · жалоб на его комментарии в очереди:{" "}
                          <strong>{r.reportsAgainstCommentAuthor}</strong>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {r.commentContext?.postTitle ? (
                    <div className="admin-report-card-post admin-muted">{r.commentContext.postTitle}</div>
                  ) : null}
                  {r.postContext?.title ? (
                    <div className="admin-report-card-post admin-muted">{r.postContext.title}</div>
                  ) : null}
                  {r.postContext?.author ? (
                    <div className="admin-report-card-author admin-muted">
                      Автор поста: <strong>{r.postContext.author.username}</strong>
                    </div>
                  ) : null}
                  <div className="admin-report-card-snippet">{excerpt}</div>
                  <div className="admin-report-card-hint">Нажмите для действий →</div>
                </button>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

      {activeTab === "tags" && canUseDictionaryTabs ? <AdminTagsPanel /> : null}

      {activeTab === "censorship" && canUseDictionaryTabs ? (
        <section className="admin-card" id="admin-section-censorship">
          <h2 className="admin-h2">Словарь цензуры</h2>
          <p className="admin-hint">
            По умолчанию в списке показывается <strong>маска</strong> (первая буква + *** + последняя), чтобы
            на демонстрации не отображалась лексика. Показать одну строку можно кнопкой «Показать». Внизу таблицы
            можно включить <strong>показ всех фраз без маски</strong> для всего списка.
          </p>

          {wordsErr ? <div className="admin-alert">{wordsErr}</div> : null}
          {bulkResult ? <div className="admin-alert" style={{ borderColor: "rgba(46, 204, 113, 0.35)" }}>{bulkResult}</div> : null}

          <div className="admin-toolbar" id="admin-censorship-form">
            <input
              className="admin-input"
              type={wordRevealInput ? "text" : "password"}
              placeholder="Слово или фраза"
              value={wordPhrase}
              onChange={(e) => setWordPhrase(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setWordRevealInput((v) => !v)}
              title={wordRevealInput ? "Скрыть ввод" : "Показать ввод"}
            >
              {wordRevealInput ? "Скрыть" : "Показать"}
            </button>
          </div>

          <div className="admin-toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
            <select
              className="admin-input admin-input-sm"
              value={wordAction}
              onChange={(e) => setWordAction(e.target.value as "censor" | "block")}
            >
              <option value="censor">Заменить</option>
              <option value="block">Блокировать</option>
            </select>
            <select
              className="admin-input admin-input-sm"
              value={wordScope}
              onChange={(e) =>
                setWordScope(
                  e.target.value as "all" | "posts" | "comments" | "messages" | "profile"
                )
              }
            >
              <option value="all">Везде</option>
              <option value="posts">Посты</option>
              <option value="comments">Комментарии</option>
              <option value="messages">Сообщения</option>
              <option value="profile">Профиль</option>
            </select>
            <select
              className="admin-input admin-input-sm"
              value={wordSeverity}
              onChange={(e) => setWordSeverity(e.target.value as "low" | "medium" | "high")}
            >
              <option value="low">Низкая</option>
              <option value="medium">Средняя</option>
              <option value="high">Высокая</option>
            </select>
            <input
              className="admin-input admin-input-sm"
              type="text"
              placeholder="Замена (например ***)"
              value={wordReplacement}
              onChange={(e) => setWordReplacement(e.target.value)}
              style={{ minWidth: 140 }}
            />

            <button
              type="button"
              className="btn btn-primary"
              disabled={saving === "words-form"}
              onClick={() => void submitWordForm()}
            >
              {saving === "words-form"
                ? "Сохранение…"
                : wordFormMode === "edit"
                  ? "Сохранить"
                  : "Добавить"}
            </button>
            {wordFormMode === "edit" ? (
              <button type="button" className="btn btn-ghost" onClick={() => resetWordForm()}>
                Отмена
              </button>
            ) : null}
          </div>

          <div className="admin-card" style={{ marginTop: 12 }}>
            <h3 className="admin-h3">Загрузка пачкой</h3>
            <p className="admin-hint">
              Вставьте список слов/фраз (каждое с новой строки или через запятую). Будут применены текущие настройки
              действия/области/важности сверху. Уже существующие записи будут пропущены.
            </p>
            <textarea
              className="admin-input"
              style={{ minHeight: 120, width: "100%", resize: "vertical" }}
              value={bulkPhrasesRaw}
              onChange={(e) => setBulkPhrasesRaw(e.target.value)}
              placeholder={"Например:\nслово1\nфраза 2\nслово3"}
            />
            <div className="admin-toolbar" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving === "words-bulk"}
                onClick={() => void submitBulkWords()}
              >
                {saving === "words-bulk" ? "Загрузка…" : "Добавить пачкой"}
              </button>
            </div>
          </div>

          {wordsLoading ? (
            <p className="admin-muted">Загрузка…</p>
          ) : words.length === 0 ? (
            <p className="admin-muted">Пока нет правил.</p>
          ) : (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Фраза</th>
                      <th>Действие</th>
                      <th>Область</th>
                      <th>Важность</th>
                      <th>Активно</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {words.map((w) => {
                      const manualReveal = revealedPhraseById[w.id];
                      const masked =
                        w.maskedPhrase || maskModerationPhrase(w.phrase ?? manualReveal ?? "");
                      const displayPhrase = wordsShowUncensored
                        ? (w.phrase ?? masked)
                        : manualReveal || w.phrase || masked;
                      const rowRevealed = Boolean(manualReveal || w.phrase);
                      return (
                        <tr key={w.id}>
                          <td>
                            <div
                              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                            >
                              <span
                                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                              >
                                {displayPhrase}
                              </span>
                              {!wordsShowUncensored ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => void toggleRevealPhrase(w.id)}
                                >
                                  {rowRevealed ? "Скрыть" : "Показать"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td>{w.action === "block" ? "Блокировать" : "Заменить"}</td>
                          <td>
                            {w.scope === "all"
                              ? "Везде"
                              : w.scope === "posts"
                                ? "Посты"
                                : w.scope === "comments"
                                  ? "Комментарии"
                                  : w.scope === "messages"
                                    ? "Сообщения"
                                    : "Профиль"}
                          </td>
                          <td>{moderationSeverityRu(w.severity)}</td>
                          <td>{w.isActive ? "Да" : "Нет"}</td>
                          <td>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => void startEditWord(w.id)}
                              >
                                Редактировать
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                disabled={saving === `words-del-${w.id}`}
                                onClick={() => void deleteWord(w.id)}
                              >
                                {saving === `words-del-${w.id}` ? "…" : "Удалить"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label className="admin-censor-reveal admin-censor-reveal--animated">
                <input
                  type="checkbox"
                  className="admin-censor-reveal-input"
                  checked={wordsShowUncensored}
                  onChange={(e) => setWordsShowUncensored(e.target.checked)}
                />
                <span className="admin-censor-reveal-switch" aria-hidden />
                <span className="admin-censor-reveal-label">Показать все фразы без маски</span>
              </label>
            </>
          )}
        </section>
      ) : null}

      {activeTab === "moderation" ? (
      <section className="admin-card" id="admin-section-moderation">
        <h2 className="admin-h2">Модерация контента</h2>
        <p className="admin-hint">
          Последние посты сеткой: нажмите квадрат — снизу откроется тема и действия. Комментарии удаляются из
          очереди жалоб или с поста на форуме.
        </p>
        {moderationToast ? <div className="admin-mod-toast">{moderationToast}</div> : null}

        {postsList.length ? (
          <>
            <div className="admin-hint admin-hint-tight">Посты (нажмите квадрат):</div>
            <div className="admin-mod-grid">
              {postsList.map((p) => {
                const active = moderationFocus?.id === p.id;
                const hasCover = Boolean(p.coverImage);
                const thumbLeaving =
                  moderationClosing?.postId === p.id && moderationClosing.dropFromGrid;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`admin-mod-card${active ? " admin-mod-card-active" : ""}${hasCover ? " admin-mod-card-has-cover" : ""}${thumbLeaving ? " admin-mod-card-leaving" : ""}`}
                    onClick={() => setModerationFocus((cur) => (cur?.id === p.id ? null : p))}
                  >
                    <span className="admin-mod-card-bg" aria-hidden="true">
                      {p.coverImage ? (
                        <img
                          src={p.coverImage}
                          alt=""
                          className="admin-mod-card-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className="admin-mod-card-placeholder" />
                      )}
                      <span className="admin-mod-card-scrim" />
                    </span>
                    <span className="admin-mod-card-body">
                      <span className="admin-mod-card-title">{p.title}</span>
                      <span className="admin-mod-card-meta">{p.author?.username ?? "—"}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {moderationFocus ? (
              <div
                className={`admin-mod-detail${
                  moderationClosing?.postId === moderationFocus.id ? " admin-mod-detail-leaving" : ""
                }`}
              >
                <div className="admin-mod-detail-head">
                  <div className="admin-mod-detail-top">
                    {moderationFocus.coverImage ? (
                      <img
                        src={moderationFocus.coverImage}
                        alt=""
                        className="admin-mod-detail-thumb"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    <div className="admin-mod-detail-titles">
                      <h3 className="admin-mod-detail-title">{moderationFocus.title}</h3>
                      <p className="admin-mod-detail-meta">
                        {moderationFocus.slug} · {moderationFocus.author?.username ?? "Пользователь"}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="admin-mod-detail-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void openPostModerationFromSlug(moderationFocus.slug)}
                  >
                    Панель модерации поста
                  </button>
                  <Link
                    className="btn btn-ghost btn-sm"
                    href={`/posts/${encodeURIComponent(moderationFocus.slug)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть на форуме
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setModerationFocus(null)}
                  >
                    Оставить
                  </button>
                  {!isAdmin ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void copyPostForAdminReview(moderationFocus)}
                    >
                      На рассмотрение
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={saving === `delete-post-${moderationFocus.id}`}
                    onClick={() => void deletePostById(moderationFocus)}
                  >
                    {saving === `delete-post-${moderationFocus.id}` ? "Удаление…" : "Удалить"}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
      ) : null}

      {activeTab === "users" ? (
      <section className="admin-card" id="admin-section-users">
        <h2 className="admin-h2">Пользователи</h2>
        <div className="admin-toolbar">
          <input
            className="admin-input"
            type="search"
            placeholder="Поиск по имени или email"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <button type="button" className="btn btn-ghost" onClick={() => runSearch()}>
            Найти
          </button>
        </div>

        {loading ? (
          <p className="admin-muted">Загрузка…</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Email</th>
                  <th>Роль</th>
                  <th>Бан</th>
                  {isAdmin ? <th>Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span>{u.username}</span>
                      {chiefAdminId && u.id === chiefAdminId ? (
                        <span className="admin-chief-badge">Главный</span>
                      ) : null}
                    </td>
                    <td className="admin-td-muted">{u.email ?? "—"}</td>
                    <td>
                      {isAdmin ? (
                        <select
                          className="admin-input admin-input-sm"
                          value={roleDraft[u.id] ?? u.role}
                          onChange={(e) =>
                            setRoleDraft((prev) => ({ ...prev, [u.id]: e.target.value }))
                          }
                        >
                          <option value="user">Пользователь</option>
                          <option value="moderator">Модератор</option>
                          <option value="admin">Админ</option>
                        </select>
                      ) : (
                        <span>
                          {u.role === "admin"
                            ? "Админ"
                            : u.role === "moderator"
                              ? "Модератор"
                              : "Пользователь"}
                        </span>
                      )}
                    </td>
                    <td>
                      {u.id === myId ? (
                        <span className="admin-muted">—</span>
                      ) : (
                        <div
                          className="admin-ban-toggle"
                          role="group"
                          aria-label={`Бан для ${u.username}`}
                        >
                          <button
                            type="button"
                            className={`admin-ban-opt${!u.isBanned ? " admin-ban-opt-on" : ""}`}
                            disabled={saving === `ban-${u.id}` || !u.isBanned}
                            onClick={() => void setBanned(u.id, false)}
                          >
                            Нет
                          </button>
                          <button
                            type="button"
                            className={`admin-ban-opt${u.isBanned ? " admin-ban-opt-on" : ""}`}
                            disabled={
                              saving === `ban-${u.id}` ||
                              u.isBanned ||
                              u.role === "admin"
                            }
                            title={
                              u.role === "admin" ? "Администратора нельзя заблокировать" : undefined
                            }
                            onClick={() => void setBanned(u.id, true)}
                          >
                            Да
                          </button>
                        </div>
                      )}
                    </td>
                    {isAdmin ? (
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={saving === u.id || (roleDraft[u.id] ?? u.role) === u.role}
                          onClick={() => void saveRole(u.id)}
                        >
                          Сохранить роль
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > 0 ? (
          <div className="admin-pager">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Назад
            </button>
            <span className="admin-muted">
              {pageStart}–{pageEnd} из {total} · стр. {page} / {pages}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Вперёд
            </button>
          </div>
        ) : null}
      </section>
      ) : null}

      <ReportReviewDrawer
        report={reportDrawer}
        onClose={() => setReportDrawer(null)}
        onDone={handleReportDrawerDone}
      />
    </>
  );
}
