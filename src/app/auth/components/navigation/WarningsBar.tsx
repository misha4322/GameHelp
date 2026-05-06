"use client";

import { useCallback, useEffect, useState } from "react";

import type { UserWarningDto } from "@/types/comments";

import "./WarningsBar.css";

export default function WarningsBar() {
  const [warnings, setWarnings] = useState<UserWarningDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users/me/warnings", { cache: "no-store" });
      if (!res.ok) {
        setWarnings([]);
        return;
      }
      const data = (await res.json()) as { warnings?: UserWarningDto[] };
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    } catch {
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(id: string) {
    try {
      const res = await fetch(`/api/users/me/warnings/${encodeURIComponent(id)}/dismiss`, {
        method: "POST",
      });
      if (res.ok) {
        setWarnings((prev) => prev.filter((w) => w.id !== id));
      }
    } catch {
      /* ignore */
    }
  }

  if (loading || warnings.length === 0) {
    return null;
  }

  return (
    <div className="warnings-bar-wrap container">
      {warnings.map((w) => (
        <div key={w.id} className="warnings-bar-card" role="alert">
          <div className="warnings-bar-title">Предупреждение модерации</div>
          <p className="warnings-bar-reason">
            <strong>Причина:</strong> {w.reason}
          </p>
          {w.commentSnapshot ? (
            <blockquote className="warnings-bar-quote">
              <span className="warnings-bar-quote-label">Ваш комментарий:</span>
              {w.commentSnapshot}
            </blockquote>
          ) : null}
          <button type="button" className="warnings-bar-dismiss" onClick={() => void dismiss(w.id)}>
            Понятно, скрыть
          </button>
        </div>
      ))}
    </div>
  );
}
