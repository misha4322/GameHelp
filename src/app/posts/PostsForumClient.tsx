"use client";

import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SteamGamePicker from "@/app/auth/components/steam/SteamGamePicker";
import type { PostCard, PostsListResponse } from "@/types/posts";
import type { RecommendationsHomeResponse } from "@/types/recommendations";
import type { SteamGame } from "@/types/steam";

import forum from "./Forum.module.css";
import pageStyles from "./PosPage.module.css";

const MAX_GAMES = 10;

type Tag = { id: string; name: string };

type PickedGame = {
  categoryId: string;
  appid: number;
  name: string;
  capsuleImage: string;
};

type ForumSort = "recommended" | "popular" | "new" | "old" | "views" | "likes" | "dislikes";
type DrawerId = "sort" | "games" | "tags" | null;

type SortOption = { value: ForumSort; title: string; hint: string };

const BASE_SORT_OPTIONS: SortOption[] = [
  {
    value: "popular",
    title: "Популярные",
    hint: "Просмотры, лайки и дизлайки в одном скоре.",
  },
  { value: "new", title: "Сначала новые", hint: "Свежие посты сверху." },
  { value: "old", title: "Сначала старые", hint: "Старые темы первыми." },
  { value: "views", title: "По просмотрам", hint: "Больше просмотров — выше." },
  { value: "likes", title: "По лайкам", hint: "Больше лайков — выше." },
  { value: "dislikes", title: "По дизлайкам", hint: "Больше дизлайков — выше." },
];

function sortOptionsForViewer(viewerId: string | null): SortOption[] {
  if (!viewerId) return BASE_SORT_OPTIONS;
  return [
    {
      value: "recommended",
      title: "Мои рекомендации",
      hint: "Персональная подборка — режим по умолчанию после входа.",
    },
    ...BASE_SORT_OPTIONS,
  ];
}

function forumCardTitle(title: string): string {
  return title
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/\*{1,2}/g, "")
    .replace(/`+/g, "")
    .trim();
}

/** Убираем markdown и длинные URL из превью карточки ленты */
function forumPlainPreview(content: string, maxLen = 132): string {
  let s = content
    .replace(/!\[[^\]]*\]\([^)]*\)/gi, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/gi, (_, lab: string) => ` ${lab.trim() || "ссылка"} `)
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`+/g, "")
    .replace(/https?:\/\/[^\s)\]]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.length > maxLen) return `${s.slice(0, maxLen).trim()}…`;
  return s;
}

function excerpt(content: string, n = 130) {
  const plain = forumPlainPreview(content, n + 80);
  const t = plain.slice(0, n).trim();
  if (!t) return "";
  return plain.length > t.length ? `${t}…` : t;
}

function sortSummary(sort: ForumSort, viewerId: string | null): string {
  return sortOptionsForViewer(viewerId).find((o) => o.value === sort)?.title ?? sort;
}

export default function PostsForumClient() {
  const { data: session, status } = useSession();
  const viewerId = session?.user?.id ?? null;

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [pickedGames, setPickedGames] = useState<PickedGame[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [sort, setSort] = useState<ForumSort>("popular");
  const [posts, setPosts] = useState<PostCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<DrawerId>(null);
  const [steamAddBusy, setSteamAddBusy] = useState(false);
  const [steamAddError, setSteamAddError] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);
  const defaultSortAppliedRef = useRef(false);
  const prevViewerIdRef = useRef<string | null>(null);

  const sortList = useMemo(() => sortOptionsForViewer(viewerId), [viewerId]);

  useEffect(() => {
    if (status === "loading") return;

    if (!viewerId) {
      if (prevViewerIdRef.current) {
        defaultSortAppliedRef.current = false;
      }
      prevViewerIdRef.current = null;
      setSort((s) => (s === "recommended" ? "popular" : s));
      return;
    }

    prevViewerIdRef.current = viewerId;
    if (!defaultSortAppliedRef.current) {
      defaultSortAppliedRef.current = true;
      setSort("recommended");
    }
  }, [status, viewerId]);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const hasFilters = pickedGames.length > 0 || tagIds.length > 0;
      if (sort === "recommended" && viewerId && !hasFilters) {
        const sp = new URLSearchParams({ viewerId, limit: "60" });
        const res = await fetch(`/api/recommendations/home?${sp}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as RecommendationsHomeResponse;
        const list = data.blocks?.forYou ?? [];
        setPosts(Array.isArray(list) ? list : []);
      } else {
        const categoryIds = pickedGames.map((g) => g.categoryId);
        const sp = new URLSearchParams();
        const apiSort: Exclude<ForumSort, "recommended"> =
          sort === "recommended" ? "popular" : sort;
        sp.set("sort", apiSort);
        if (categoryIds.length) sp.set("categoryIds", categoryIds.join(","));
        if (tagIds.length) sp.set("tagIds", tagIds.join(","));
        const res = await fetch(`/api/posts?${sp.toString()}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as PostsListResponse;
        setPosts(Array.isArray(data.posts) ? data.posts : []);
      }
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [pickedGames, tagIds, sort, viewerId]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void loadPosts();
    }, 380);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [loadPosts]);

  useEffect(() => {
    void (async () => {
      try {
        const tRes = await fetch("/api/tags", { cache: "no-store" });
        if (tRes.ok) {
          const tj = (await tRes.json()) as Tag[];
          setAllTags(Array.isArray(tj) ? tj : []);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  async function handleSteamPick(game: SteamGame | null) {
    if (!game) return;
    if (pickedGames.length >= MAX_GAMES) return;
    if (pickedGames.some((p) => p.appid === game.appid)) return;

    setSteamAddError(null);
    setSteamAddBusy(true);
    try {
      const qs = new URLSearchParams({ appid: String(game.appid) });
      let res = await fetch(`/api/categories/by-steam?${qs}`, { cache: "no-store" });
      let j = (await res.json()) as { category?: { id: string; title: string } | null; error?: string };
      let categoryId = j.category?.id ?? null;

      if (!categoryId) {
        if (status !== "authenticated") {
          setSteamAddError(
            "Чтобы добавить игру в фильтр, войдите в аккаунт — мы создаём категорию в каталоге, если её ещё не было."
          );
          return;
        }
        res = await fetch("/api/categories/from-steam", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appid: game.appid, name: game.name }),
        });
        j = (await res.json()) as { category?: { id: string; title: string }; error?: string };
        if (!res.ok) throw new Error(j.error || "Не удалось добавить игру");
        categoryId = j.category?.id ?? null;
        if (!categoryId) throw new Error("Пустой ответ сервера");
      }

      setPickedGames((prev) => [
        ...prev,
        {
          categoryId,
          appid: game.appid,
          name: game.name,
          capsuleImage: game.capsuleImage,
        },
      ]);
    } catch (e) {
      setSteamAddError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSteamAddBusy(false);
    }
  }

  function removePicked(appid: number) {
    setPickedGames((prev) => prev.filter((p) => p.appid !== appid));
  }

  function toggleTag(id: string) {
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function resetFilters() {
    setPickedGames([]);
    setTagIds([]);
    setSort(viewerId ? "recommended" : "popular");
    setSteamAddError(null);
  }

  function applyFiltersNow() {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    void loadPosts();
  }

  function closeDrawer() {
    setDrawer(null);
  }

  const gamesLabel =
    pickedGames.length === 0 ? "Все игры" : `${pickedGames.length} из ${MAX_GAMES}`;
  const tagsLabel = tagIds.length === 0 ? "Любые теги" : `${tagIds.length} тегов`;

  const emptyMessage =
    !loading && posts.length === 0
      ? sort === "recommended" &&
          viewerId &&
          pickedGames.length === 0 &&
          tagIds.length === 0
        ? "Пока не хватает данных для персональных рекомендаций."
        : pickedGames.length > 0 && tagIds.length > 0
          ? "По выбранным играм и тегам пока нет постов. Измените фильтры или загляните позже."
          : pickedGames.length > 0
            ? "По выбранным играм пока нет опубликованных постов."
            : tagIds.length > 0
              ? "С выбранными тегами пока нет опубликованных постов."
              : null
      : null;

  return (
    <div className={pageStyles.page}>
      <div className="container">
        <div className={pageStyles.header}>
          <div>
            <div className={pageStyles.kicker}>GameHelp</div>
            <h1 className={pageStyles.title}>Сообщество</h1>
          </div>

          <div className={pageStyles.actions}>
            <Link href="/" className={pageStyles.secondaryButton}>
              Главная
            </Link>
            <Link href="/posts/new" className={pageStyles.primaryButton}>
              + Создать пост
            </Link>
          </div>
        </div>

        <section className={forum.filterToolbar} aria-label="Фильтры ленты">
          <div className={forum.filterToolbarRow}>
            <button
              type="button"
              className={`${forum.filterPill}${drawer === "sort" ? ` ${forum.filterPillActive}` : ""}`}
              aria-expanded={drawer === "sort"}
              aria-controls="forum-drawer"
              onClick={() => setDrawer((d) => (d === "sort" ? null : "sort"))}
            >
              <span className={forum.filterPillK}>Сортировка</span>
              <span className={forum.filterPillV}>{sortSummary(sort, viewerId)}</span>
            </button>
            <button
              type="button"
              className={`${forum.filterPill}${drawer === "games" ? ` ${forum.filterPillActive}` : ""}`}
              aria-expanded={drawer === "games"}
              aria-controls="forum-drawer"
              onClick={() => setDrawer((d) => (d === "games" ? null : "games"))}
            >
              <span className={forum.filterPillK}>Игры</span>
              <span className={forum.filterPillV}>{gamesLabel}</span>
            </button>
            <button
              type="button"
              className={`${forum.filterPill}${drawer === "tags" ? ` ${forum.filterPillActive}` : ""}`}
              aria-expanded={drawer === "tags"}
              aria-controls="forum-drawer"
              onClick={() => setDrawer((d) => (d === "tags" ? null : "tags"))}
            >
              <span className={forum.filterPillK}>Теги</span>
              <span className={forum.filterPillV}>{tagsLabel}</span>
            </button>
          </div>
          <div className={forum.filterToolbarMeta}>
            <button
              type="button"
              className={forum.linkBtn}
              disabled={
                !pickedGames.length &&
                !tagIds.length &&
                (viewerId ? sort === "recommended" : sort === "popular")
              }
              onClick={() => resetFilters()}
            >
              Сбросить всё
            </button>
            <button type="button" className={forum.linkBtn} disabled={loading} onClick={() => applyFiltersNow()}>
              {loading ? "Загрузка…" : "Обновить сейчас"}
            </button>
          </div>
        </section>

        {drawer ? (
          <>
            <button
              type="button"
              className={forum.drawerBackdrop}
              aria-label="Закрыть панель"
              onClick={closeDrawer}
            />
            <div
              id="forum-drawer"
              className={forum.drawerSheet}
              role="dialog"
              aria-modal="true"
              aria-labelledby="forum-drawer-title"
            >
              <div className={forum.drawerGrab} aria-hidden />
              <div className={forum.drawerHead}>
                <h2 id="forum-drawer-title" className={forum.drawerTitle}>
                  {drawer === "sort" && "Сортировка"}
                  {drawer === "games" && "Игры"}
                  {drawer === "tags" && "Теги"}
                </h2>
                <button type="button" className={forum.drawerClose} onClick={closeDrawer} aria-label="Закрыть">
                  ×
                </button>
              </div>

              <div className={forum.drawerBody}>
                {drawer === "sort" ? (
                  <div className={forum.optionList} role="listbox" aria-label="Порядок сортировки">
                    {sortList.map((opt) => {
                      const on = sort === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="option"
                          aria-selected={on}
                          className={`${forum.optionRow}${on ? ` ${forum.optionRowOn}` : ""}`}
                          onClick={() => {
                            setSort(opt.value);
                          }}
                        >
                          <span className={forum.optionTitle}>{opt.title}</span>
                          <span className={forum.optionHint}>{opt.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {drawer === "games" ? (
                  <>
                    <p className={forum.drawerHint}>
                      До {MAX_GAMES} игр: тот же поиск Steam, что и при создании поста. Пост попадает в выборку, если
                      привязан к любой из выбранных категорий.
                    </p>
                    {pickedGames.length > 0 ? (
                      <div className={forum.steamPickedStack}>
                        {pickedGames.map((g) => (
                          <div key={g.appid} className="selected-game">
                            <div className="selected-game-info">
                              <Image
                                src={g.capsuleImage}
                                alt=""
                                width={184}
                                height={69}
                                className="selected-game-image"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                              <div className="selected-game-name">{g.name}</div>
                            </div>
                            <button type="button" className="btn-remove" onClick={() => removePicked(g.appid)}>
                              ✕ Убрать
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {pickedGames.length < MAX_GAMES ? (
                      <SteamGamePicker selectedGame={null} onSelect={(game) => void handleSteamPick(game)} />
                    ) : (
                      <p className={forum.mutedEmpty}>Достигнут лимит {MAX_GAMES} игр. Уберите одну, чтобы добавить другую.</p>
                    )}

                    {steamAddBusy ? <p className={forum.steamBusy}>Добавляем в фильтр…</p> : null}
                    {steamAddError ? <p className={forum.steamErr}>{steamAddError}</p> : null}

                    <div className={forum.drawerFoot}>
                      <button
                        type="button"
                        className={forum.resetBtn}
                        disabled={!pickedGames.length}
                        onClick={() => {
                          setPickedGames([]);
                          setSteamAddError(null);
                        }}
                      >
                        Сбросить игры
                      </button>
                    </div>
                  </>
                ) : null}

                {drawer === "tags" ? (
                  <>
                    <p className={forum.drawerHint}>
                      Несколько тегов — пост должен содержать хотя бы один из выбранных.
                    </p>
                    <div className={forum.chipScroll}>
                      <div className={forum.chipRow}>
                        {allTags.map((t) => {
                          const active = tagIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={`${forum.chip}${active ? ` ${forum.chipActive}` : ""}`}
                              onClick={() => toggleTag(t.id)}
                            >
                              #{t.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {allTags.length === 0 ? (
                      <p className={forum.mutedEmpty}>Теги не загружены.</p>
                    ) : null}
                    <div className={forum.drawerFoot}>
                      <button
                        type="button"
                        className={forum.resetBtn}
                        disabled={!tagIds.length}
                        onClick={() => setTagIds([])}
                      >
                        Очистить теги
                      </button>
                    </div>
                  </>
                ) : null}
              </div>

              <div className={forum.drawerActions}>
                <button type="button" className={forum.applyBtn} onClick={closeDrawer}>
                  Готово
                </button>
              </div>
            </div>
          </>
        ) : null}

        {emptyMessage ? <div className={forum.emptyBanner}>{emptyMessage}</div> : null}

        {loading && posts.length === 0 ? (
          <div className={forum.loadingLine}>Загрузка постов…</div>
        ) : posts.length === 0 && !emptyMessage ? (
          <div className={pageStyles.empty}>
            Пока нет постов. <Link href="/posts/new">Создать первую тему</Link>
          </div>
        ) : (
          <div className={pageStyles.grid}>
            {posts.map((post) => {
              const preview = excerpt(post.content);
              return (
                <Link key={post.id} href={`/posts/${post.slug}`} className={pageStyles.card}>
                  {post.coverImage ? (
                    <img src={post.coverImage} alt="" className={pageStyles.cover} loading="lazy" />
                  ) : (
                    <div className={pageStyles.coverPlaceholder}>🎮</div>
                  )}
                  <div className={pageStyles.cardBody}>
                    {post.category?.title ? (
                      <div className={pageStyles.cardMeta}>{post.category.title}</div>
                    ) : null}
                    <div className={pageStyles.cardTitle}>{forumCardTitle(post.title)}</div>
                    {preview ? <div className={pageStyles.cardExcerpt}>{preview}</div> : null}
                    <div className={pageStyles.cardStats}>
                      <span>{post.views ?? 0} просм.</span>
                      <span>👍 {post.likeCount ?? 0}</span>
                      <span>👎 {post.dislikeCount ?? 0}</span>
                    </div>
                    {post.tags?.length ? (
                      <div className={pageStyles.tags}>
                        {post.tags.slice(0, 6).map((tg) => (
                          <span key={tg.id} className={pageStyles.tag}>
                            #{tg.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className={pageStyles.cardFooter}>
                      {post.author?.username ?? "Автор"}
                      {post.author?.isFriend ? (
                        <span className={pageStyles.friendMark}> · друг</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
