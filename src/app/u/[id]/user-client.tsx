"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "@/lib/api";
import FavoriteGamesBlock from "@/app/profile/FavoriteGamesBlock";
import { FriendsIcon, PersonRemoveIcon } from "@/components/icons/FriendsIcon";
import styles from "./UserClient.module.css";

export default function UserClient({
  userId,
  viewerId,
}: {
  userId: string;
  viewerId: string | null;
}) {
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [bannerBroken, setBannerBroken] = useState(false);

  const load = useCallback(async () => {
    try {
      setMessage("");

      const result = await apiRequest(`/users/${userId}`, {
        query: viewerId ? { viewerId } : undefined,
      });

      setData(result);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка";
      setMessage(text);
    }
  }, [userId, viewerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setAvatarBroken(false);
    setBannerBroken(false);
  }, [data?.user?.avatarUrl, data?.user?.profileBannerUrl]);

  async function addFriend() {
    if (!viewerId) {
      setMessage("Сначала войди в аккаунт");
      return;
    }

    try {
      const result = await apiRequest("/friends/request", {
        method: "POST",
        body: JSON.stringify({
          userId: viewerId,
          targetId: userId,
        }),
      });

      if (result.status === "incoming") {
        setMessage(
          result.message ??
            "У вас уже есть входящая заявка от этого пользователя."
        );
      } else if (result.status === "accepted") {
        setMessage("Вы уже друзья ✅");
      } else {
        setMessage("Заявка отправлена ⏳");
      }

      await load();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка";
      setMessage(text);
    }
  }

  async function acceptFriend() {
    if (!viewerId) {
      setMessage("Сначала войди в аккаунт");
      return;
    }

    try {
      await apiRequest("/friends/accept", {
        method: "POST",
        body: JSON.stringify({
          userId: viewerId,
          requesterId: userId,
        }),
      });

      setMessage("Заявка принята ✅");
      await load();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка";
      setMessage(text);
    }
  }

  async function removeFriend() {
    if (!viewerId) {
      setMessage("Сначала войди в аккаунт");
      return;
    }

    try {
      await apiRequest("/friends/remove", {
        method: "POST",
        body: JSON.stringify({
          userId: viewerId,
          targetId: userId,
        }),
      });

      setMessage("Пользователь удалён из друзей");
      await load();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка";
      setMessage(text);
    }
  }

  function renderFriendActions() {
    if (friendStatus === "self") {
      return (
        <>
          <Link href="/settings" className={styles.primaryButton}>
            Настройки профиля
          </Link>
          <Link href="/friends" className={`${styles.secondaryButton} ${styles.btnWithIcon}`}>
            <FriendsIcon size={18} />
            Мои друзья
          </Link>
          <Link href="/messages" className={styles.secondaryButton}>
            Сообщения
          </Link>
        </>
      );
    }

    if (friendStatus === "friends") {
      return (
        <>
          <Link href={`/messages?with=${user.id}`} className={styles.secondaryButton}>
            💬 Написать
          </Link>
          <button
            type="button"
            className={`${styles.dangerButton} ${styles.btnWithIcon}`}
            onClick={() => void removeFriend()}
          >
            <PersonRemoveIcon size={18} />
            Удалить из друзей
          </button>
        </>
      );
    }

    if (friendStatus === "incoming") {
      return (
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void acceptFriend()}
        >
          Принять заявку
        </button>
      );
    }

    if (friendStatus === "outgoing") {
      return (
        <button type="button" className={styles.disabledButton} disabled>
          Заявка отправлена
        </button>
      );
    }

    return (
      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => void addFriend()}
      >
        Добавить в друзья
      </button>
    );
  }

  if (!data && message) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBox}>{message}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingBox}>Загрузка профиля...</div>
      </div>
    );
  }

  const { user, friendStatus, counts, recentPosts } = data;
  const safeCounts = counts ?? { posts: 0, comments: 0, friends: 0 };
  const safeRecentPosts = Array.isArray(recentPosts) ? recentPosts : [];
  const isOwner = friendStatus === "self" || viewerId === userId;
  const isPrivateForViewer = Boolean(user.isProfilePrivate) && !isOwner;
  const effectiveCanView = !isPrivateForViewer;
  const visibleBannerUrl = effectiveCanView ? user.profileBannerUrl : null;
  const visibleAvatarUrl = effectiveCanView ? user.avatarUrl : null;
  const visibleStatusText = effectiveCanView ? user.statusText : null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.bannerWrap}>
          {visibleBannerUrl && !bannerBroken ? (
            <img
              src={visibleBannerUrl}
              alt="banner"
              className={styles.banner}
              onError={() => setBannerBroken(true)}
            />
          ) : (
            <div className={styles.bannerPlaceholder} />
          )}
          <div className={styles.bannerBack}>
            <Link href="/friends" className={styles.backButton}>
              ← К поиску людей
            </Link>
          </div>
        </div>

        <div className={styles.hero}>
          {visibleAvatarUrl && !avatarBroken ? (
            <img
              src={visibleAvatarUrl}
              alt={user.username}
              className={styles.avatar}
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <div className={styles.avatarPlaceholder}>
              {(user.username?.[0] ?? "U").toUpperCase()}
            </div>
          )}

          <div className={styles.heroInfo}>
            <h1 className={styles.title}>{user.username}</h1>

            {visibleStatusText ? <div className={styles.status}>{visibleStatusText}</div> : null}

            <div className={styles.meta}>
              <span className={styles.uuidRow}>
                UUID: <code className={styles.uuidCode}>{user.id}</code>
              </span>
              {user.createdAt ? (
                <span>
                  На сайте с {new Date(user.createdAt).toLocaleDateString("ru-RU")}
                </span>
              ) : null}
            </div>

            <div className={styles.meta}>
              {user.isProfilePrivate ? (
                <span>Профиль закрытый</span>
              ) : (
                <span>Профиль открытый</span>
              )}
              {user.showEmail && user.email ? <span>Email: {user.email}</span> : null}
            </div>
          </div>
        </div>

        <div className={styles.friendPanel}>
          <div className={styles.friendPanelTitle}>
            {friendStatus === "self" ? "Управление профилем" : "Дружба и связь"}
          </div>
          <div className={styles.headerActions}>{renderFriendActions()}</div>
        </div>

        {message ? <div className={styles.message}>{message}</div> : null}

        {!effectiveCanView ? (
          <div className={styles.privateBox}>
            🔒 Этот профиль закрыт.
          </div>
        ) : (
          <>
            <div className={styles.statsGrid}>
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
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>О пользователе</h2>

                {user.bio ? (
                  <div className={styles.bio}>{user.bio}</div>
                ) : (
                  <div className={styles.emptyBox}>Пока описание не заполнено.</div>
                )}

                <div className={styles.infoList}>
                  {user.location ? <div>📍 {user.location}</div> : null}
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
              </div>

              <div className={`${styles.section} ${styles.sectionGames}`}>
                <h2 className={styles.sectionTitle}>Любимые игры</h2>
                <FavoriteGamesBlock
                  rawFavoriteGames={user.favoriteGames}
                  editable={false}
                  stretchInColumn
                />
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Последние посты</h2>

              {safeRecentPosts.length === 0 ? (
                <div className={styles.emptyBox}>
                  У пользователя пока нет опубликованных постов.
                </div>
              ) : (
                <div className={styles.postsGrid}>
                  {safeRecentPosts.map((post: any) => (
                    <Link key={post.id} href={`/posts/${post.slug}`} className={styles.postCard}>
                      {post.coverImage ? (
                        <img src={post.coverImage} alt={post.title} className={styles.postImage} />
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}