"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import {
  HOME_FOR_YOU_DEFAULT_LIMIT,
  HOME_RECOMMENDATIONS_CHUNK_SIZE,
} from "@/lib/recommendations-display";
import type { PostCard } from "@/types/posts";
import type { RecommendationsHomeResponse } from "@/types/recommendations";

import { PostCardsSection } from "./PostCardsSection";

export function HomeRecsSection({
  viewerId,
  initialForYou,
  initialTrending,
}: {
  viewerId: string | null;
  initialForYou: PostCard[];
  initialTrending: PostCard[];
}) {
  const pathname = usePathname();
  const [forYouPosts, setForYouPosts] = useState(initialForYou);

  useEffect(() => {
    setForYouPosts(initialForYou);
  }, [initialForYou]);

  const refetch = useCallback(async () => {
    if (!viewerId) return;
    const res = await fetch(
      `/api/recommendations/home?viewerId=${encodeURIComponent(viewerId)}&limit=${HOME_FOR_YOU_DEFAULT_LIMIT}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;
    const data = (await res.json()) as RecommendationsHomeResponse;
    if (Array.isArray(data?.blocks?.forYou)) {
      setForYouPosts(data.blocks.forYou);
    }
  }, [viewerId]);

  useEffect(() => {
    if (!viewerId || pathname !== "/") return;
    void refetch();
  }, [viewerId, pathname, refetch]);

  useEffect(() => {
    if (!viewerId) return;
    const onVis = () => {
      if (document.visibilityState === "visible" && pathname === "/") {
        void refetch();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [viewerId, pathname, refetch]);

  const posts = viewerId ? forYouPosts : initialTrending;

  return (
    <PostCardsSection
      title={viewerId ? "Мои рекомендации" : "Популярное сейчас"}
      kicker={viewerId ? "Персонально" : "Сообщество"}
      posts={posts}
      emptyText={
        viewerId
          ? "Пока не хватает данных для персональных рекомендаций."
          : "Пока нет рекомендаций."
      }
      linkHref="/posts"
      linkLabel="Открыть форум →"
      block={viewerId ? "forYou" : "trending"}
      viewerId={viewerId}
      cardLayout="poster"
      chunkSize={viewerId ? HOME_RECOMMENDATIONS_CHUNK_SIZE : 0}
    />
  );
}
