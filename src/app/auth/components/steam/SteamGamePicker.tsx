"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SteamGame } from "@/types/steam";
import "./SteamGamePicker.css";

const PAGE = 40;

export default function SteamGamePicker({
  onSelect,
  selectedGame,
}: {
  onSelect: (game: SteamGame | null) => void;
  selectedGame: SteamGame | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [games, setGames] = useState<SteamGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async (query: string, offset: number, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    params.set("offset", String(offset));
    params.set("limit", String(PAGE));
    if (query.trim()) params.set("search", query.trim());
    const res = await fetch(`/api/steam/games?${params.toString()}`, { signal });
    if (!res.ok) {
      throw new Error(`Steam API HTTP ${res.status}`);
    }
    const data = await res.json();
    const list = (data.games || []) as SteamGame[];
    return {
      games: list,
      hasMore: !!data.hasMore,
      total: typeof data.total === "number" ? data.total : list.length,
    };
  }, []);

  const loadInitial = useCallback(
    async (query: string) => {
      fetchAbortRef.current?.abort();
      const ac = new AbortController();
      fetchAbortRef.current = ac;
      setLoading(true);
      try {
        const { games: list, hasMore: more } = await fetchPage(query, 0, ac.signal);
        if (ac.signal.aborted) return;
        setGames(list);
        setNextOffset(list.length);
        setHasMore(more);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        console.error("Error searching games:", error);
        setGames([]);
        setHasMore(false);
        setNextOffset(0);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [fetchPage]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore) return;
    setLoadingMore(true);
    try {
      const { games: list, hasMore: more } = await fetchPage(search, nextOffset);
      setGames((prev) => [...prev, ...list]);
      setNextOffset((o) => o + list.length);
      setHasMore(more);
    } catch (error) {
      console.error("Error loading more games:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, loading, loadingMore, nextOffset, search]);

  useEffect(() => {
    if (!isOpen) return;

    const delay = search.trim() ? 450 : 0;
    const timer = setTimeout(() => {
      void loadInitial(search);
    }, delay);

    return () => clearTimeout(timer);
  }, [search, isOpen, loadInitial]);

  useEffect(() => {
    if (!isOpen || !hasMore) return;
    const root = listRef.current;
    const target = loadMoreSentinelRef.current;
    if (!root || !target) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root, rootMargin: "120px", threshold: 0 }
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [isOpen, hasMore, loadMore, games.length]);

  return (
    <div className="steam-picker">
      <label className="steam-label">🎮 Выбор игры (необязательно)</label>

      {selectedGame ? (
        <div className="selected-game">
          <div className="selected-game-top">
            <div className="selected-game-thumb">
              <Image
                src={selectedGame.capsuleImage}
                alt=""
                width={184}
                height={69}
                className="selected-game-image"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="btn-remove"
              aria-label="Убрать выбранную игру"
              title="Убрать"
            >
              ✕
            </button>
          </div>
          <div className="selected-game-name">{selectedGame.name}</div>
        </div>
      ) : (
        <button type="button" onClick={() => setIsOpen(true)} className="btn-select">
          Выбрать
        </button>
      )}

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Выберите игру</h3>
              <button onClick={() => setIsOpen(false)} className="modal-close" type="button">
                ✕
              </button>
            </div>

            <input
              type="text"
              placeholder="🔍 Поиск игры..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
              autoFocus
            />

            <div ref={listRef} className="games-list games-list-scroll">
              {loading ? (
                <div className="loading">Загрузка...</div>
              ) : games.length === 0 ? (
                <div className="empty">
                  {search ? "Игры не найдены" : "Начните вводить название"}
                </div>
              ) : (
                <>
                  {games.map((game) => (
                    <button
                      key={game.appid}
                      type="button"
                      onClick={() => {
                        onSelect(game);
                        setIsOpen(false);
                        setSearch("");
                      }}
                      className="game-item"
                    >
                      <Image
                        src={game.capsuleImage}
                        alt={game.name}
                        width={92}
                        height={35}
                        className="game-image"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <span className="game-name">{game.name}</span>
                    </button>
                  ))}
                  {hasMore && <div ref={loadMoreSentinelRef} style={{ height: 1 }} aria-hidden />}
                  {loadingMore && <div className="loading">Подгрузка…</div>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
