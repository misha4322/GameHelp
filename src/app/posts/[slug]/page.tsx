import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import ReactMarkdown from "react-markdown";

import { authOptions } from "@/lib/auth-options";
import Comments from "@/app/auth/components/comments/Comments";
import PostReactions from "@/app/auth/components/PostReactions";
import PostPageActions from "@/app/posts/[slug]/PostPageActions";
import SharePostButton from "@/app/posts/SharePostButton";
import { getServerBaseUrl } from "@/lib/server-base-url";
import type { PostDetails, PostDetailsResponse } from "@/types/posts";

import styles from "./PosPage.module.css";

async function getPost(slug: string, viewerId?: string | null): Promise<PostDetails | null> {
  const base = await getServerBaseUrl();
  const url = new URL(`${base}/api/posts/${encodeURIComponent(slug)}`);

  if (viewerId) {
    url.searchParams.set("viewerId", viewerId);
  }

  const res = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Post page fetch failed:", res.status, text);
    throw new Error("Failed to load post");
  }

  const data = (await res.json().catch(() => null)) as PostDetailsResponse | null;

  if (!data || !data.post) {
    return null;
  }

  return data.post;
}

export default async function PostPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const session = await getServerSession(authOptions);
  const viewerId = session?.user?.id ?? null;

  const post = await getPost(slug, viewerId);

  if (!post) {
    notFound();
  }

  const authorHref = post.author?.id ? `/u/${post.author.id}` : null;

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.layout}>
          <div className={styles.main}>
            <div className={styles.navigation}>
              <Link href="/posts" className={styles.navLink}>
                ← К сообществу
              </Link>
              <Link href="/" className={styles.navLink}>
                Главная
              </Link>
            </div>

            <article className={styles.heroCard}>
              {post.coverImage ? (
                <img
                  src={post.coverImage}
                  alt={post.title ?? "Обложка поста"}
                  className={styles.cover}
                />
              ) : (
                <div className={styles.coverPlaceholder}>🎮</div>
              )}

              <div className={styles.heroBody}>
                <h1 className={styles.title}>{post.title}</h1>

                <div className={styles.meta}>
                  <span className={styles.metaItem}>
                    Автор:{" "}
                    {authorHref ? (
                      <Link href={authorHref} className={styles.authorLink}>
                        {post.author?.username ?? "Пользователь"}
                      </Link>
                    ) : (
                      <span>{post.author?.username ?? "Пользователь"}</span>
                    )}
                  </span>

                  {post.category ? (
                    <span className={styles.metaItem}>
                      Игра: {post.category.title}
                    </span>
                  ) : null}

                  {post.createdAt ? (
                    <span className={styles.metaItem}>
                      Опубликовано:{" "}
                      {new Date(post.createdAt).toLocaleString("ru-RU")}
                    </span>
                  ) : null}
                </div>

                {post.tags?.length ? (
                  <div className={styles.tags}>
                    {post.tags.map((tag) => (
                      <span key={tag.id} className={styles.tag}>
                        #{tag.name}
                      </span>
                    ))}
                  </div>
                ) : null}

                <PostPageActions
                  slug={post.slug}
                  title={post.title}
                  authorId={post.author?.id}
                  viewerId={viewerId}
                  viewerRole={session?.user?.role ?? "user"}
                />

                <div className={styles.actions}>
                  <PostReactions
                    userId={viewerId}
                    slug={slug}
                    likeCount={Number(post.likeCount) || 0}
                    dislikeCount={Number(post.dislikeCount) || 0}
                    likedByMe={!!post.likedByMe}
                    dislikedByMe={!!post.dislikedByMe}
                  />

                  <SharePostButton postId={post.id} slug={post.slug} title={post.title} />
                </div>
              </div>
            </article>

            <section className={styles.contentCard}>
              <div className={styles.content}>
                <ReactMarkdown>{post.content}</ReactMarkdown>
              </div>
            </section>
            <Comments
              postSlug={slug}
              userId={viewerId}
              viewerRole={session?.user?.role ?? "user"}
            />
          </div>

          <aside className={styles.sidebar}>
            <div className={styles.sideCard}>
              <h2 className={styles.sideTitle}>О публикации</h2>

              <div className={styles.sideList}>
                <div className={styles.sideItem}>
                  <span>👍 Лайков</span>
                  <strong>{Number(post.likeCount) || 0}</strong>
                </div>

                <div className={styles.sideItem}>
                  <span>👎 Дизлайков</span>
                  <strong>{Number(post.dislikeCount) || 0}</strong>
                </div>

                <div className={styles.sideItem}>
                  <span>🏷️ Тегов</span>
                  <strong>{Array.isArray(post.tags) ? post.tags.length : 0}</strong>
                </div>
              </div>
            </div>

            <div className={styles.sideCard}>
              <h2 className={styles.sideTitle}>Автор</h2>

              <div className={styles.authorCard}>
                {post.author?.avatarUrl ? (
                  <img
                    src={post.author.avatarUrl}
                    alt={post.author.username ?? "Автор"}
                    className={styles.authorAvatar}
                  />
                ) : (
                  <div className={styles.authorAvatarPlaceholder}>
                    {(post.author?.username?.[0] ?? "U").toUpperCase()}
                  </div>
                )}

                <div className={styles.authorInfo}>
                  {authorHref ? (
                    <Link href={authorHref} className={styles.authorName}>
                      {post.author?.username ?? "Пользователь"}
                    </Link>
                  ) : (
                    <div className={styles.authorName}>
                      {post.author?.username ?? "Пользователь"}
                    </div>
                  )}

                  {post.category ? (
                    <div className={styles.authorMeta}>
                      Категория: {post.category.title}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}