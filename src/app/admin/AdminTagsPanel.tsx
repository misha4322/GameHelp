"use client";

import { useCallback, useEffect, useState } from "react";

type TagRow = { id: string; name: string };

export default function AdminTagsPanel() {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/tags", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as TagRow[] | null;
      if (!res.ok || !Array.isArray(data)) {
        setErr("Не удалось загрузить теги");
        setTags([]);
        return;
      }
      setTags(data);
    } catch {
      setErr("Ошибка сети");
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTag() {
    const n = name.trim();
    if (n.length < 2) {
      setErr("Минимум 2 символа");
      return;
    }
    setBusy("create");
    setErr("");
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setName("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function deleteTag(id: string) {
    if (!window.confirm("Удалить тег? Он пропадёт у всех постов, где был привязан.")) return;
    setBusy(id);
    setErr("");
    try {
      const res = await fetch(`/api/tags?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-card" id="admin-section-tags">
      <h2 className="admin-h2">Теги форума</h2>
      <p className="admin-hint">
        Создание и удаление тегов доступно только администратору. Список помогает видеть, что уже есть в
        базе. На форуме пользователи выбирают только существующие теги при создании поста.
      </p>

      {err ? <div className="admin-alert">{err}</div> : null}

      <div className="admin-tags-create">
        <label className="admin-tags-label">
          Новый тег
          <input
            className="admin-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: гайд, мемы, обзор"
            maxLength={50}
            disabled={busy !== null}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createTag();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => void createTag()}
        >
          {busy === "create" ? "…" : "Добавить тег"}
        </button>
      </div>

      {loading ? (
        <p className="admin-muted">Загрузка…</p>
      ) : (
        <div className="admin-tags-table-wrap">
          <table className="admin-tags-table">
            <thead>
              <tr>
                <th>Название</th>
                <th className="admin-tags-col-act">Действие</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="admin-tags-name">#{t.name}</span>
                    <span className="admin-tags-id admin-muted">{t.id}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busy !== null}
                      onClick={() => void deleteTag(t.id)}
                    >
                      {busy === t.id ? "…" : "Удалить"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tags.length === 0 ? <p className="admin-muted">Тегов пока нет.</p> : null}
        </div>
      )}
    </section>
  );
}
