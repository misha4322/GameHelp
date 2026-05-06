"use client";

import Link from "next/link";
import styles from "../FriendsClient.module.css";
import type { FriendRequest } from "../types";

type Props = {
  request: FriendRequest;
  onAccept: (id: string) => Promise<void>;
};

export default function RequestCard({ request, onAccept }: Props) {
  return (
    <div className={styles.smallCard}>
      <div>
        <Link href={`/u/${request.from.id}`} className={styles.userName}>
          {request.from.username}
        </Link>
        <div className={styles.userMeta}>ID: {request.from.id}</div>
      </div>

      <button type="button" className={styles.primaryButton} onClick={() => void onAccept(request.from.id)}>
        Принять
      </button>
    </div>
  );
}
