"use client";

import Link from "next/link";
import styles from "../FriendsClient.module.css";
import type { FriendUser } from "../types";

type Props = {
  user: FriendUser;
  onAdd: (id: string) => Promise<void>;
  onAccept: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

export default function SearchUserCard({ user, onAdd, onAccept, onRemove }: Props) {
  return (
    <div
      className={`${styles.userCard} ${
        user.friendStatus === "outgoing" ? styles.userCardPending : ""
      } ${user.friendStatus === "incoming" ? styles.userCardIncoming : ""}`.trim()}
    >
      <div className={styles.userInfo}>
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.username} className={styles.userAvatar} />
        ) : (
          <div className={styles.userAvatarPlaceholder}>
            {(user.username?.[0] ?? "U").toUpperCase()}
          </div>
        )}

        <div>
          <Link href={`/u/${user.id}`} className={styles.userName}>
            {user.username}
          </Link>
          <div className={styles.userMeta}>
            <span>UUID: {user.id}</span>
            <button
              type="button"
              className={styles.copySmall}
              onClick={() => {
                void navigator.clipboard
                  .writeText(user.id)
                  .then(() => {})
                  .catch(() => {});
              }}
            >
              Копировать
            </button>
          </div>
        </div>
      </div>

      <div className={styles.userActions}>
        {user.friendStatus === "self" ? (
          <button type="button" className={styles.disabledButton} disabled>
            Это вы
          </button>
        ) : user.friendStatus === "friends" ? (
          <button type="button" className={styles.dangerButton} onClick={() => void onRemove(user.id)}>
            Удалить
          </button>
        ) : user.friendStatus === "incoming" ? (
          <button type="button" className={styles.primaryButton} onClick={() => void onAccept(user.id)}>
            Принять
          </button>
        ) : user.friendStatus === "outgoing" ? (
          <button type="button" className={styles.disabledButton} disabled>
            Заявка отправлена
          </button>
        ) : (
          <button type="button" className={styles.primaryButton} onClick={() => void onAdd(user.id)}>
            Добавить
          </button>
        )}
      </div>
    </div>
  );
}
