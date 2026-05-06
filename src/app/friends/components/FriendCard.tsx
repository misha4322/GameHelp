"use client";

import Link from "next/link";
import styles from "../FriendsClient.module.css";
import type { FriendUser } from "../types";

type Props = {
  friend: FriendUser;
  onRemove: (id: string) => Promise<void>;
};

export default function FriendCard({ friend, onRemove }: Props) {
  return (
    <div className={styles.smallCard}>
      <div className={styles.friendCardMain}>
        {friend.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={friend.avatarUrl}
            alt=""
            className={styles.friendCardAvatar}
          />
        ) : (
          <div className={styles.friendCardAvatarPlaceholder} aria-hidden>
            {(friend.username?.[0] ?? "U").toUpperCase()}
          </div>
        )}
        <div className={styles.friendCardText}>
          <Link href={`/u/${friend.id}`} className={styles.userName}>
            {friend.username}
          </Link>
          <div className={styles.userMeta}>
            <span className={styles.friendIdLabel}>ID:</span>{" "}
            <span className={styles.friendIdValue}>{friend.id}</span>
          </div>
        </div>
      </div>

      <button type="button" className={styles.dangerButton} onClick={() => void onRemove(friend.id)}>
        Удалить
      </button>
    </div>
  );
}
