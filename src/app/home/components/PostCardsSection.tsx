"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import type { PostCard } from "@/types/posts";
import type { RecommendationBlockName } from "@/types/recommendations";

type PostCardsSectionProps = {
  title: string;
  kicker: string;
  posts: PostCard[];
  emptyText: string;
  linkHref?: string;
  linkLabel?: string;
  block?: RecommendationBlockName;
  viewerId?: string | null;
  /** Постер без текста под обложкой — ровная сетка на главной */
  cardLayout?: "default" | "poster";
};

function sendRecommendationEvent(
  payload: {
    viewerId?: string;
    postId: string;
    block: RecommendationBlockName;
    eventType: "impression" | "click";
  },
  useBeacon = false
) {
  const endpoint = "/api/recommendations/event";
  const body = JSON.stringify(payload);

  if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(endpoint, blob);
    return;
  }

  void fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function PostCardsSection({
  title,
  kicker,
  posts,
  emptyText,
  linkHref,
  linkLabel,
  block,
  viewerId,
  cardLayout = "default",
}: PostCardsSectionProps) {
  const impressionSentRef = useRef(false);

  const postIds = useMemo(() => posts.map((post) => post.id), [posts]);

  useEffect(() => {
    if (!block || !postIds.length || impressionSentRef.current) {
      return;
    }
    impressionSentRef.current = true;

    for (const postId of postIds.slice(0, 8)) {
      sendRecommendationEvent(
        { viewerId: viewerId ?? undefined, postId, block, eventType: "impression" },
        true
      );
    }
  }, [block, postIds, viewerId]);

  return (
    <section className="container home-section">
      <div className="home-section-header">
        <div>
          <div className="home-section-kicker">{kicker}</div>
          <h2 className="home-section-title">{title}</h2>
        </div>
        {linkHref && linkLabel ? (
          <Link href={linkHref} className="home-section-link">
            {linkLabel}
          </Link>
        ) : null}
      </div>

      {!posts.length ? (
        <div className="home-empty">{emptyText}</div>
      ) : (
        <div className="home-posts-grid">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/posts/${post.slug}`}
              className={`home-post-card${cardLayout === "poster" ? " home-post-cardPoster" : ""}`}
              onClick={() => {
                if (!block) return;
                sendRecommendationEvent({
                  viewerId: viewerId ?? undefined,
                  postId: post.id,
                  block,
                  eventType: "click",
                });
              }}
            >
              <span className="home-visually-hidden">{post.title}</span>
              {post.coverImage ? (
                <img src={post.coverImage} alt="" className="home-post-cover" aria-hidden />
              ) : (
                <div className="home-post-cover placeholder" aria-hidden>
                  🎮
                </div>
              )}

              {cardLayout === "default" ? (
                <div className="home-post-body">
                  <div className="home-post-title">{post.title}</div>
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
