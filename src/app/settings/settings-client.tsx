"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiRequest, ApiRequestError } from "@/lib/api";
import ModerationBlockedPreview from "@/components/ModerationBlockedPreview";
import { ModerationBlockedMirrorTextarea } from "@/components/ModerationBlockedMirrorField";
import type { ModerationTextMatch } from "@/lib/moderation/moderate-text";
import type { SettingsResponse } from "@/types/settings";
import styles from "./SettingsClient.module.css";

export default function SettingsClient({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState<string | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileBannerUrl, setProfileBannerUrl] = useState<string | null>(null);

  const [statusText, setStatusText] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [steamProfileUrl, setSteamProfileUrl] = useState("");

  const [showEmail, setShowEmail] = useState(false);
  const [isProfilePrivate, setIsProfilePrivate] = useState(false);

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState(false);

  const [message, setMessage] = useState("");
  const [profileModBlock, setProfileModBlock] = useState<{
    field: string;
    text: string;
    matches: ModerationTextMatch[];
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastSavedPayload = useRef<string>("");

  const [avatarError, setAvatarError] = useState(false);

  const avatarSrc = useMemo(() => avatarPreview ?? avatarUrl, [avatarPreview, avatarUrl]);

  useEffect(() => {
    setAvatarError(false);
  }, [avatarSrc]);
  const bannerSrc = useMemo(
    () => bannerPreview ?? profileBannerUrl,
    [bannerPreview, profileBannerUrl]
  );

  useEffect(() => {
    setBannerError(false);
  }, [bannerSrc]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setMessage("");

        const data = await apiRequest<SettingsResponse>(`/users/me`, {
          method: "GET",
        });

        if (cancelled) return;

        const user = data.user;

        setUsername(user.username ?? "");
        setEmail(user.email ?? null);
        setAvatarUrl(user.avatarUrl ?? null);
        setProfileBannerUrl(user.profileBannerUrl ?? null);
        setStatusText(user.statusText ?? "");
        setBio(user.bio ?? "");
        setLocation(user.location ?? "");
        setTelegram(user.telegram ?? "");
        setDiscord(user.discord ?? "");
        setSteamProfileUrl(user.steamProfileUrl ?? "");
        setShowEmail(!!user.showEmail);
        setIsProfilePrivate(!!user.isProfilePrivate);
        lastSavedPayload.current = JSON.stringify({
          userId,
          username: user.username ?? "",
          avatarUrl: user.avatarUrl ?? null,
          profileBannerUrl: user.profileBannerUrl ?? null,
          statusText: user.statusText ?? null,
          bio: user.bio ?? null,
          location: user.location ?? null,
          websiteUrl: null,
          telegram: user.telegram ?? null,
          discord: user.discord ?? null,
          steamProfileUrl: user.steamProfileUrl ?? null,
          showEmail: !!user.showEmail,
          isProfilePrivate: !!user.isProfilePrivate,
        });
        setLoaded(true);
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "Ошибка загрузки настроек");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function uploadSingle(
    file: File,
    type: "avatar" | "banner",
    setUploading: (value: boolean) => void
  ): Promise<string> {
    setUploading(true);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });

      const text = await res.text();
      let json: any = {};

      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error("Сервер загрузки вернул не JSON");
        }
      }

      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Ошибка загрузки файла"
        );
      }

      const url = Array.isArray(json?.urls) ? json.urls[0] : null;
      if (!url || typeof url !== "string") {
        throw new Error("Upload вернул пустой url");
      }

      return url;
    } finally {
      setUploading(false);
    }
  }

  async function uploadAvatarHandler() {
    if (!avatarFile) return;

    try {
      setMessage("");
      const url = await uploadSingle(avatarFile, "avatar", setUploadingAvatar);
      setAvatarUrl(url);
      setAvatarPreview(null);
      setAvatarFile(null);
      await apiRequest(`/users/me`, {
        method: "PATCH",
        body: JSON.stringify({
          userId,
          avatarUrl: url,
        }),
      });
      setMessage("Аватар загружен и применён ✅");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки аватара");
    }
  }

  async function uploadBannerHandler() {
    if (!bannerFile) return;

    try {
      setMessage("");
      const url = await uploadSingle(bannerFile, "banner", setUploadingBanner);
      setProfileBannerUrl(url);
      setBannerPreview(null);
      setBannerFile(null);
      await apiRequest(`/users/me`, {
        method: "PATCH",
        body: JSON.stringify({
          userId,
          profileBannerUrl: url,
        }),
      });
      setMessage("Баннер загружен и сразу установлен в профиль ✅");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки баннера");
    }
  }

  const profilePayload = useMemo(
    () => ({
      userId,
      username,
      avatarUrl,
      profileBannerUrl,
      statusText: statusText || null,
      bio: bio || null,
      location: location || null,
      websiteUrl: null,
      telegram: telegram || null,
      discord: discord || null,
      steamProfileUrl: steamProfileUrl || null,
      showEmail,
      isProfilePrivate,
    }),
    [
      userId,
      username,
      avatarUrl,
      profileBannerUrl,
      statusText,
      bio,
      location,
      telegram,
      discord,
      steamProfileUrl,
      showEmail,
      isProfilePrivate,
    ]
  );

  async function saveProfile(payload: typeof profilePayload, silent = false) {
    try {
      if (!silent) {
        setMessage("");
        setProfileModBlock(null);
      }

      await apiRequest(`/users/me`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      lastSavedPayload.current = JSON.stringify(payload);
      setProfileModBlock(null);
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === "MODERATION_BLOCKED" &&
        error.matches?.length
      ) {
        const key = error.sourceField ?? "bio";
        const raw = (payload as Record<string, unknown>)[key];
        setProfileModBlock({
          field: key,
          text: typeof raw === "string" ? raw : "",
          matches: error.matches,
        });
      } else if (!silent) {
        setProfileModBlock(null);
      }
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    }
  }

  useEffect(() => {
    if (!loaded) return;

    const payloadJson = JSON.stringify(profilePayload);
    if (payloadJson === lastSavedPayload.current) return;

    const timer = window.setTimeout(() => {
      void saveProfile(profilePayload, true);
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loaded, profilePayload]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.box}>Загрузка настроек...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Настройки профиля</h1>
            <p className={styles.subtitle}>
              Здесь редактируются данные профиля, изображения и приватность.
            </p>
          </div>

          <Link href="/profile" className={styles.backButton}>
            ← Назад в профиль
          </Link>
        </div>

        {/* Секция загрузки баннера */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Баннер профиля</h2>

          {bannerSrc && !bannerError ? (
            <img 
              src={bannerSrc} 
              alt="banner" 
              className={styles.bannerPreview} 
              onError={() => setBannerError(true)}
            />
          ) : (
            <div className={styles.bannerPlaceholder}>Баннер не загружен</div>
          )}

          <div className={styles.uploadRow}>
            <label className={styles.fileButton}>
              Выбрать баннер
              <input
                type="file"
                accept="image/*"
                className={styles.hiddenInput}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setBannerFile(file);

                  if (file) {
                    setBannerPreview(URL.createObjectURL(file));
                  } else {
                    setBannerPreview(null);
                  }
                }}
              />
            </label>

            <button
              type="button"
              className={styles.secondaryButton}
              disabled={!bannerFile || uploadingBanner}
              onClick={() => void uploadBannerHandler()}
            >
              {uploadingBanner ? "Загрузка..." : "Загрузить баннер"}
            </button>

            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => {
                void (async () => {
                  try {
                    setMessage("");
                    setProfileBannerUrl(null);
                    setBannerPreview(null);
                    setBannerFile(null);
                    await apiRequest(`/users/me`, {
                      method: "PATCH",
                      body: JSON.stringify({ userId, profileBannerUrl: null }),
                    });
                    setMessage("Баннер убран из профиля ✅");
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : "Ошибка");
                  }
                })();
              }}
            >
              Удалить баннер
            </button>
          </div>
        </div>

        {/* Аватар + Приватность */}
        <div className={styles.grid}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Аватар</h2>

            <div className={styles.avatarRow}>
              {avatarSrc && !avatarError ? (
                <img 
                  src={avatarSrc} 
                  alt="avatar" 
                  className={styles.avatar} 
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <div className={styles.avatarPlaceholder}>
                  {(username?.[0] ?? "U").toUpperCase()}
                </div>
              )}

              <div className={styles.avatarActions}>
                <label className={styles.fileButton}>
                  Выбрать фото
                  <input
                    type="file"
                    accept="image/*"
                    className={styles.hiddenInput}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setAvatarFile(file);

                      if (file) {
                        setAvatarPreview(URL.createObjectURL(file));
                      } else {
                        setAvatarPreview(null);
                      }
                    }}
                  />
                </label>

                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={!avatarFile || uploadingAvatar}
                  onClick={() => void uploadAvatarHandler()}
                >
                  {uploadingAvatar ? "Загрузка..." : "Загрузить"}
                </button>

                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => {
                    void (async () => {
                      try {
                        setMessage("");
                        setAvatarUrl(null);
                        setAvatarPreview(null);
                        setAvatarFile(null);
                        await apiRequest(`/users/me`, {
                          method: "PATCH",
                          body: JSON.stringify({ userId, avatarUrl: null }),
                        });
                        setMessage("Аватар убран из профиля ✅");
                      } catch (e) {
                        setMessage(e instanceof Error ? e.message : "Ошибка");
                      }
                    })();
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Приватность</h2>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={isProfilePrivate}
                onChange={(e) => setIsProfilePrivate(e.target.checked)}
              />
              <span>Сделать профиль приватным</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={showEmail}
                onChange={(e) => setShowEmail(e.target.checked)}
              />
              <span>Показывать email в профиле</span>
            </label>

            <div className={styles.field}>
              <label className={styles.label}>Email аккаунта</label>
              <input
                value={email ?? ""}
                readOnly
                className={styles.input}
                placeholder="Email"
              />
            </div>
          </div>
        </div>

        {/* Основная информация */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Основная информация</h2>

          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label}>Никнейм</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={styles.input}
                placeholder="Ник"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Статус</label>
              <input
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                className={styles.input}
                placeholder="Например: Ищу пати в CS2"
                maxLength={120}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Локация</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={styles.input}
                placeholder="Например: Berlin"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Telegram</label>
              <input
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                className={styles.input}
                placeholder="@username"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Discord</label>
              <input
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
                className={styles.input}
                placeholder="nickname#0000"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Steam Profile URL</label>
              <input
                value={steamProfileUrl}
                onChange={(e) => setSteamProfileUrl(e.target.value)}
                className={styles.input}
                placeholder="https://steamcommunity.com/..."
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>О себе</label>
            {profileModBlock?.field === "bio" ? (
              <ModerationBlockedMirrorTextarea
                value={bio}
                onChange={(e) => {
                  setBio(e.target.value);
                  setProfileModBlock(null);
                }}
                matches={profileModBlock.matches}
                shellClassName={styles.textareaBioMirrorShell}
                textareaClassName={styles.textareaBioMirrorInner}
                placeholder="Напиши несколько слов о себе"
                rows={5}
              />
            ) : (
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className={styles.textarea}
                placeholder="Напиши несколько слов о себе"
                rows={5}
              />
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Любимые игры</label>
            <p className={styles.hintP}>
              Список настраивается на странице{" "}
              <Link href="/profile" className={styles.inlineLink}>
                профиля
              </Link>
              : через поиск Steam (как при создании поста); список на профиле с прокруткой.
            </p>
          </div>
        </div>

        {profileModBlock && profileModBlock.field !== "bio" ? (
          <div className={styles.field}>
            <ModerationBlockedPreview
              text={profileModBlock.text}
              matches={profileModBlock.matches}
            />
          </div>
        ) : null}
        {message ? <div className={styles.message}>{message}</div> : null}
      </div>
    </div>
  );
}