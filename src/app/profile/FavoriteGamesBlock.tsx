"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import SteamGamePicker from "@/app/auth/components/steam/SteamGamePicker";
import { apiRequest, ApiRequestError } from "@/lib/api";
import ModerationBlockedPreview from "@/components/ModerationBlockedPreview";
import type { ModerationTextMatch } from "@/lib/moderation/moderate-text";
import {
  parseFavoriteGamesField,
  serializeFavoriteGames,
  type FavoriteGameEntry,
  steamCapsuleUrl,
} from "@/lib/favorite-games";
import type { SteamGame } from "@/types/steam";

import styles from "./FavoriteGamesBlock.module.css";

type Props = {
  rawFavoriteGames: string | null | undefined;
  editable: boolean;
  onUpdated?: () => void;
  /** В двухколоночном профиле: список игр заполняет высоту карточки, скролл только при переполнении. */
  stretchInColumn?: boolean;
};

export default function FavoriteGamesBlock({
  rawFavoriteGames,
  editable,
  onUpdated,
  stretchInColumn = false,
}: Props) {
  const [entries, setEntries] = useState<FavoriteGameEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [modBlock, setModBlock] = useState<{
    text: string;
    matches: ModerationTextMatch[];
  } | null>(null);

  useEffect(() => {
    setEntries(parseFavoriteGamesField(rawFavoriteGames));
  }, [rawFavoriteGames]);

  const persist = useCallback(
    async (next: FavoriteGameEntry[]) => {
      if (!editable) return;
      setSaving(true);
      setErr("");
      setModBlock(null);
      try {
        const value = next.length ? serializeFavoriteGames(next) : null;
        await apiRequest(`/users/me`, {
          method: "PATCH",
          body: JSON.stringify({ favoriteGames: value }),
        });
        setEntries(next);
        onUpdated?.();
      } catch (e) {
        if (e instanceof ApiRequestError && e.code === "MODERATION_BLOCKED" && e.matches?.length) {
          const value = next.length ? serializeFavoriteGames(next) : "";
          setModBlock({ text: value, matches: e.matches });
        } else {
          setModBlock(null);
        }
        setErr(e instanceof Error ? e.message : "Ошибка сохранения");
      } finally {
        setSaving(false);
      }
    },
    [editable, onUpdated]
  );

  async function addSteam(game: SteamGame | null) {
    if (!game || !editable) return;
    if (entries.some((e) => e.appid === game.appid)) return;
    const next = [...entries, { appid: game.appid, name: game.name }];
    await persist(next);
  }

  async function removeAt(i: number) {
    if (!editable) return;
    const next = entries.filter((_, idx) => idx !== i);
    await persist(next);
  }

  if (!entries.length && !editable) {
    return <div className={styles.empty}>Список любимых игр пуст.</div>;
  }

  return (
    <div className={`${styles.wrap} ${stretchInColumn ? styles.wrapStretch : ""}`}>
      {modBlock ? (
        <ModerationBlockedPreview text={modBlock.text} matches={modBlock.matches} />
      ) : null}
      {err ? <div className={styles.err}>{err}</div> : null}

      {!entries.length && editable ? (
        <div className={styles.empty}>
          Добавляйте игры через поиск Steam — так же, как при создании поста. Список ниже прокручивается и не
          раздвигает шапку профиля.
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className={`${styles.scroll} ${stretchInColumn ? styles.scrollStretch : ""}`}>
          <div className={styles.row}>
            {entries.map((e, i) => (
              <div
                key={e.appid != null ? `a-${e.appid}` : `n-${i}-${e.name}`}
                className={styles.chip}
                tabIndex={e.appid != null ? 0 : undefined}
              >
                {e.appid != null ? (
                  <span className={styles.pop} aria-hidden>
                    <Image
                      src={steamCapsuleUrl(e.appid)}
                      alt=""
                      width={184}
                      height={69}
                      className={styles.popImg}
                      sizes="184px"
                      unoptimized
                    />
                  </span>
                ) : null}
                <span className={styles.name}>{e.name}</span>
                {editable ? (
                  <button
                    type="button"
                    className={styles.rm}
                    onClick={() => void removeAt(i)}
                    aria-label={`Убрать ${e.name}`}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {editable ? (
        <div className={styles.steam}>
          <SteamGamePicker selectedGame={null} onSelect={(g) => void addSteam(g)} />
          {saving ? <p className={styles.hint}>Сохранение…</p> : null}
        </div>
      ) : null}
    </div>
  );
}
