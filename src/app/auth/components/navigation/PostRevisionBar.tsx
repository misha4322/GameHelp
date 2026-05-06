"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  POST_REVISION_REFRESH_EVENT,
  revisionSlugMatches,
  type PostRevisionRefreshDetail,
} from "@/lib/post-revision-refresh";

import "./PostRevisionBar.css";

type RevisionItem = {
  slug: string;
  title: string;
  note: string | null;
  requestedAt: string | null;
};

/** Дата через toLocaleString только после mount — иначе SSR ≠ клиент (React #418). */
function RevisionRequestedAt({ iso }: { iso: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    setLabel(new Date(iso).toLocaleString("ru-RU"));
  }, [iso]);

  return (
    <span className="revision-bar-date">
      {" "}
      · запрос от {label || "…"}
    </span>
  );
}

export default function PostRevisionBar() {
  const pathname = usePathname();
  const [items, setItems] = useState<RevisionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/users/me/post-revision-requests?t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { items?: RevisionItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    const onRefresh = (ev: Event) => {
      const detail = (ev as CustomEvent<PostRevisionRefreshDetail>).detail;
      if (detail?.slug) {
        const s = detail.slug;
        setItems((prev) => prev.filter((p) => !revisionSlugMatches(p.slug, s)));
      }
      void load();
    };
    window.addEventListener(POST_REVISION_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(POST_REVISION_REFRESH_EVENT, onRefresh);
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  if (loading || items.length === 0) {
    return null;
  }

  return (
    <div className="revision-bar-wrap container">
      {items.map((item) => (
        <div key={item.slug} className="revision-bar-card" role="status">
          <div className="revision-bar-title">Модерация: нужно обновить пост</div>
          <p className="revision-bar-post">
            <strong>{item.title}</strong>
            {item.requestedAt ? <RevisionRequestedAt iso={item.requestedAt} /> : null}
          </p>
          {item.note ? (
            <p className="revision-bar-note">
              <strong>Комментарий модератора:</strong> {item.note}
            </p>
          ) : null}
          <p className="revision-bar-hint">
            Внесите правки и сохраните пост — тогда напоминание исчезнет.
          </p>
          <Link
            className="revision-bar-cta"
            href={`/posts/${encodeURIComponent(item.slug)}/edit`}
          >
            Открыть в редакторе
          </Link>
        </div>
      ))}
    </div>
  );
}
