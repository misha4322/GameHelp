"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PostReactions(props: {
  userId: string | null;
  slug: string;
  likeCount: number;
  dislikeCount: number;
  likedByMe: boolean;
  dislikedByMe: boolean;
}) {
  const router = useRouter();
  const [likeCount, setLikeCount] = useState(props.likeCount);
  const [dislikeCount, setDislikeCount] = useState(props.dislikeCount);
  const [likedByMe, setLikedByMe] = useState(props.likedByMe);
  const [dislikedByMe, setDislikedByMe] = useState(props.dislikedByMe);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLikeCount(props.likeCount);
    setDislikeCount(props.dislikeCount);
    setLikedByMe(props.likedByMe);
    setDislikedByMe(props.dislikedByMe);
  }, [props.likeCount, props.dislikeCount, props.likedByMe, props.dislikedByMe]);

  async function react(type: "like" | "dislike") {
    if (loading) return;

    if (!props.userId) {
      window.location.href = "/auth/login";
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(props.slug)}/reaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: props.userId,
          type,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;

      setLikeCount(Number(data.likeCount) || 0);
      setDislikeCount(Number(data.dislikeCount) || 0);
      setLikedByMe(!!data.likedByMe);
      setDislikedByMe(!!data.dislikedByMe);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="post-reactions">
      <button
        type="button"
        disabled={loading}
        onClick={() => void react("like")}
        className={`post-reaction-button ${likedByMe ? "active" : ""}`}
      >
        <span>👍</span>
        <span>{likeCount}</span>
      </button>

      <button
        type="button"
        disabled={loading}
        onClick={() => void react("dislike")}
        className={`post-reaction-button negative ${dislikedByMe ? "active" : ""}`}
      >
        <span>👎</span>
        <span>{dislikeCount}</span>
      </button>
    </div>
  );
}