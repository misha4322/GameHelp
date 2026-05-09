"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "@/lib/api";
import FriendCard from "./components/FriendCard";
import { FriendSearchIcon } from "@/components/icons/FriendSearchIcon";
import RequestCard from "./components/RequestCard";
import SearchUserCard from "./components/SearchUserCard";
import type { FriendRequest, FriendUser } from "./types";
import styles from "./FriendsClient.module.css";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export default function FriendsClient({ userId }: { userId: string }) {
  const [me, setMe] = useState<any>(null);
  const [searchValue, setSearchValue] = useState("");
  const [directValue, setDirectValue] = useState("");
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [found, setFound] = useState<FriendUser[]>([]);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "warn" } | null>(null);
  const [loading, setLoading] = useState(true);

  function showToast(text: string, kind: "ok" | "warn" = "ok") {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 1800);
  }

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setMessage("");

      const [meResult, friendsResult, requestsResult] = await Promise.all([
        apiRequest(`/users/me`),
        apiRequest(`/friends/list`),
        apiRequest(`/friends/requests`),
      ]);

      setMe(meResult.user ?? null);
      setFriends(friendsResult.friends ?? []);
      setRequests(requestsResult.requests ?? []);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка загрузки";
      setMessage(text);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const searchUsers = useCallback(async () => {
    try {
      setMessage("");

      const q = searchValue.trim();
      if (!q) {
        setFound([]);
        return;
      }

      const result = await apiRequest("/users/search", {
        query: {
          q,
          viewerId: userId,
        },
      });

      setFound(result.users ?? []);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка поиска";
      setMessage(text);
    }
  }, [searchValue, userId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void searchUsers();
    }, 350);
    return () => clearTimeout(t);
  }, [searchValue, searchUsers]);

  async function sendDirectRequest() {
    try {
      setMessage("");

      const value = directValue.trim();
      if (!value) {
        setMessage("Введи UUID пользователя");
        showToast("Введите UUID пользователя", "warn");
        return;
      }

      if (!isUuid(value)) {
        setMessage("Здесь поддерживается только UUID пользователя");
        showToast("Нужен UUID (пример: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)", "warn");
        return;
      }

      const result = await apiRequest("/friends/request", {
        method: "POST",
        body: JSON.stringify({
          userId,
          targetId: value,
        }),
      });

      if (result.status === "incoming") {
        setMessage(
          result.message ??
            "У вас уже есть входящая заявка от этого пользователя."
        );
        showToast("Есть входящая заявка — откройте её справа", "warn");
      } else if (result.status === "accepted") {
        setMessage("Вы уже друзья ✅");
        showToast("Вы уже друзья ✅", "ok");
      } else {
        setMessage("Заявка отправлена ⏳");
        showToast("Заявка отправлена", "ok");
      }

      setDirectValue("");
      await loadAll();
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Ошибка отправки заявки";
      setMessage(text);
      showToast("Ошибка отправки", "warn");
    }
  }

  async function addById(targetId: string) {
    try {
      setMessage("");

      const result = await apiRequest("/friends/request", {
        method: "POST",
        body: JSON.stringify({
          userId,
          targetId,
        }),
      });

      if (result.status === "incoming") {
        setMessage(
          result.message ??
            "У вас уже есть входящая заявка от этого пользователя."
        );
        showToast("Есть входящая заявка — откройте её справа", "warn");
      } else if (result.status === "accepted") {
        setMessage("Вы уже друзья ✅");
        showToast("Вы уже друзья ✅", "ok");
      } else {
        setMessage("Заявка отправлена ⏳");
        showToast("Заявка отправлена", "ok");
      }

      await loadAll();
      await searchUsers();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка";
      setMessage(text);
      showToast("Ошибка", "warn");
    }
  }

  async function accept(requesterId: string) {
    try {
      setMessage("");

      await apiRequest("/friends/accept", {
        method: "POST",
        body: JSON.stringify({
          userId,
          requesterId,
        }),
      });

      setMessage("Заявка принята ✅");
      showToast("Заявка принята ✅", "ok");
      await loadAll();
      await searchUsers();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка";
      setMessage(text);
      showToast("Ошибка", "warn");
    }
  }

  async function remove(targetId: string) {
    try {
      setMessage("");

      await apiRequest("/friends/remove", {
        method: "POST",
        body: JSON.stringify({
          userId,
          targetId,
        }),
      });

      setMessage("Пользователь удалён из друзей");
      showToast("Удалено из друзей", "ok");
      await loadAll();
      await searchUsers();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка";
      setMessage(text);
      showToast("Ошибка", "warn");
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.box}>Загрузка друзей...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {toast ? (
        <div
          className={`${styles.toast} ${toast.kind === "warn" ? styles.toastWarn : styles.toastOk}`}
          role="status"
          aria-live="polite"
        >
          {toast.text}
        </div>
      ) : null}
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Друзья и поиск людей</h1>
            <p className={styles.subtitle}>
              Поиск в реальном времени: ник, UUID или друг-код (0000-0000).
            </p>
          </div>

          <Link href="/profile" className={styles.backButton}>
            ← Профиль
          </Link>
        </div>

        {me?.id ? (
          <div className={styles.codeCard}>
            <div className={styles.codeLabel}>Твой UUID</div>
            <div className={styles.codeValue}>{me.id}</div>
            <button
              type="button"
              className={styles.codeCopy}
              onClick={() => {
                void navigator.clipboard
                  .writeText(me.id)
                  .then(() => setMessage("UUID скопирован"))
                  .catch(() => setMessage("Не удалось скопировать"));
              }}
            >
              Скопировать
            </button>
          </div>
        ) : null}

        <div className={styles.topGrid}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Быстрое добавление</h2>

            <div className={styles.row}>
              <input
                value={directValue}
                onChange={(e) => setDirectValue(e.target.value)}
                className={styles.input}
                placeholder="UUID пользователя"
              />
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void sendDirectRequest()}
              >
                Добавить
              </button>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionSearchHeader}>
              <FriendSearchIcon className={styles.searchFriendIcon} size={26} />
              <h2 className={`${styles.sectionTitle} ${styles.sectionSearchTitle}`}>Поиск друга</h2>
            </div>

            <div className={styles.row}>
              <input
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className={styles.input}
                placeholder="Поиск по нику"
                aria-label="Поиск по нику"
              />
            </div>
          </div>
        </div>

        {message ? <div className={styles.message}>{message}</div> : null}

        <div className={styles.mainGrid}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Результаты поиска</h2>

            {!found.length ? (
              <div className={styles.empty}>Ничего не найдено.</div>
            ) : (
              <div className={styles.list}>
                {found.map((user) => (
                  <SearchUserCard
                    key={user.id}
                    user={user}
                    onAdd={addById}
                    onAccept={accept}
                    onRemove={remove}
                  />
                ))}
              </div>
            )}
          </div>

          <div className={styles.sideColumn}>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Входящие заявки</h2>

              {!requests.length ? (
                <div className={styles.empty}>Нет заявок.</div>
              ) : (
                <div className={styles.list}>
                  {requests.map((row) => (
                    <RequestCard key={row.from.id} request={row} onAccept={accept} />
                  ))}
                </div>
              )}
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Мои друзья</h2>

              {!friends.length ? (
                <div className={styles.empty}>Список друзей пуст.</div>
              ) : (
                <div className={styles.list}>
                  {friends.map((friend) => (
                    <FriendCard key={friend.id} friend={friend} onRemove={remove} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}