"use client";

import Link from "next/link";

export default function SharePostButton({
  postId,
  slug,
  title,
}: {
  postId: string;
  slug: string;
  title: string;
}) {
  const params = new URLSearchParams({
    sharePostId: postId,
    sharePostSlug: slug,
    shareTitle: title,
  });

  return (
    <Link href={`/messages?${params.toString()}`} className="post-share-button">
      💬 Отправить другу
    </Link>
  );
}