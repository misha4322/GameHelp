"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "@/lib/api";
import FavoriteGamesBlock from "./FavoriteGamesBlock";
import styles from "./ProfileClient.module.css";

function isLikelyNoiseStatus(value: string): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  // Слишком "случайные" строки без пробелов/слов — скрываем (как на скрине wre4...).
  if (s.length >= 18 && !/\s/.test(s) && /^[a-z0-9_]+$/i.test(s)) return true;
  return false;
}

export default function ProfileClient({ userId }: { userId: string }) {
  const [data, setData] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [bannerBroken, setBannerBroken] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await apiRequest(`/users/me`);
      setData(result);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка загрузки профиля";
      setMessage(text);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setAvatarBroken(false);
    setBannerBroken(false);
  }, [data?.user?.avatarUrl, data?.user?.profileBannerUrl]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setMessage("Не удалось скопировать UUID");
    }
  }

  if (!data && message) {
    return (
      <div className={styles.page}>
        <div className="container">
          <div className={styles.messageBox}>{message}</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className="container">
          <div className={styles.messageBox}>Загрузка профиля...</div>
        </div>
      </div>
    );
  }

  const { user, counts, recentPosts } = data;
  const safeCounts = counts ?? { posts: 0, comments: 0, friends: 0 };
  const safeRecentPosts = Array.isArray(recentPosts) ? recentPosts : [];
  const statusText = typeof user?.statusText === "string" ? user.statusText.trim() : "";
  const showStatus = statusText && !isLikelyNoiseStatus(statusText);

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.card}>
          {user.profileBannerUrl && !bannerBroken ? (
            <img
              src={user.profileBannerUrl}
              alt="Баннер профиля"
              className={styles.banner}
              onError={() => setBannerBroken(true)}
            />
          ) : (
            <div className={styles.bannerPlaceholder} />
          )}

          <div className={styles.hero}>
            <div className={styles.avatarWrap}>
              {user.avatarUrl && !avatarBroken ? (
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  className={styles.avatar}
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <div className={styles.avatarPlaceholder}>
                  {(user.username?.[0] ?? "U").toUpperCase()}
                </div>
              )}
            </div>

            <div className={styles.heroContent}>
              <div className={styles.topRow}>
                <div>
                  <h1 className={styles.title}>{user.username}</h1>
                  {showStatus ? <div className={styles.status}>{statusText}</div> : null}
                </div>

                <div className={styles.badge}>
                  {user.isProfilePrivate ? "Приватный профиль" : "Публичный профиль"}
                </div>
              </div>

              <div className={styles.meta}>
                <span>UUID: {user.id}</span>
                {user.createdAt ? (
                  <span>
                    На сайте с {new Date(user.createdAt).toLocaleDateString("ru-RU")}
                  </span>
                ) : null}
              </div>

              <div className={styles.actions}>
                <button type="button" className={styles.primaryButton} onClick={copyId}>
                  {copied ? "✅ UUID скопирован" : "📋 Скопировать UUID"}
                </button>

                <Link href="/settings" className={styles.secondaryButton}>
                  ⚙️ Настройки
                </Link>

                <Link href="/friends" className={styles.secondaryButton}>
                  🤝 Друзья
                </Link>

                <Link href="/messages" className={styles.secondaryButton}>
                  💬 Сообщения
                </Link>
              </div>
            </div>
          </div>

          {message ? <div className={styles.inlineMessage}>{message}</div> : null}

          <div className={styles.stats}>
            <div className={styles.statCard}>
              <div className={styles.statValue}>{safeCounts.posts}</div>
              <div className={styles.statLabel}>Постов</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statValue}>{safeCounts.comments}</div>
              <div className={styles.statLabel}>Комментариев</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statValue}>{safeCounts.friends}</div>
              <div className={styles.statLabel}>Друзей</div>
            </div>
          </div>

          <div className={styles.columns}>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>О себе</h2>

              {user.bio ? (
                <div className={styles.bio}>{user.bio}</div>
              ) : (
                <div className={styles.emptyBox}>Пока описание не заполнено.</div>
              )}

              <div className={styles.infoList}>
                {user.location ? <div>📍 {user.location}</div> : null}
                {user.showEmail && user.email ? <div>✉️ {user.email}</div> : null}
                {user.websiteUrl ? (
                  <a
                    href={user.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.link}
                  >
                    🌐 {user.websiteUrl}
                  </a>
                ) : null}
                {user.telegram ? <div>📨 {user.telegram}</div> : null}
                {user.discord ? <div>🎧 {user.discord}</div> : null}
                {user.steamProfileUrl ? (
                  <a
                    href={user.steamProfileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.link}
                  >
                    🎮 Steam профиль
                  </a>
                ) : null}
              </div>
            </section>

            <section className={`${styles.section} ${styles.sectionGames}`}>
              <h2 className={styles.sectionTitle}>Любимые игры</h2>
              <FavoriteGamesBlock
                rawFavoriteGames={user.favoriteGames}
                editable
                stretchInColumn
                onUpdated={() => void load()}
              />
            </section>
          </div>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Последние посты</h2>
              <Link href="/posts" className={styles.sectionLink}>
                Все посты →
              </Link>
            </div>

            {safeRecentPosts.length === 0 ? (
              <div className={styles.emptyBox}>Пока нет опубликованных постов.</div>
            ) : (
              <div className={styles.postsGrid}>
                {safeRecentPosts.map((post: any) => (
                  <Link key={post.id} href={`/posts/${post.slug}`} className={styles.postCard}>
                    {post.coverImage ? (
                      <img
                        src={post.coverImage}
                        alt={post.title}
                        className={styles.postImage}
                      />
                    ) : (
                      <div className={styles.postImagePlaceholder}>🎮</div>
                    )}

                    <div className={styles.postBody}>
                      <div className={styles.postTitle}>{post.title}</div>
                      <div className={styles.postDate}>
                        {post.createdAt
                          ? new Date(post.createdAt).toLocaleString("ru-RU")
                          : "—"}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}