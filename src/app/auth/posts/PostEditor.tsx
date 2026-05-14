"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import SteamGamePicker from "@/app/auth/components/steam/SteamGamePicker";
import {
  ModerationBlockedMirrorInput,
  ModerationBlockedMirrorTextarea,
} from "@/components/ModerationBlockedMirrorField";
import { useBanRestriction } from "@/contexts/BanRestrictionContext";
import { formatBanCountdown } from "@/lib/ban-countdown";
import { emitPostRevisionRefresh } from "@/lib/post-revision-refresh";
import { readModerationBlockedPayload } from "@/lib/moderation/parse-blocked-response";
import type { ModerationTextMatch } from "@/lib/moderation/moderate-text";
import type { Category, Tag } from "@/types/forum";
import type { SteamGame } from "@/types/steam";

import styles from "./PostEditor.module.css";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToEditorHtml(markdown: string): string {
  const re = /!\[[^\]]*]\((https?:\/\/[^\s)]+)\)/gi;
  let html = "";
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = re.exec(markdown)) !== null) {
    const textPart = markdown.slice(cursor, match.index);
    const imgUrl = match[1]?.trim();
    html += escapeHtml(textPart).replace(/\n/g, "<br>");
    if (imgUrl) {
      html += `<img data-inline-image="1" src="${escapeHtml(imgUrl)}" alt="изображение" class="${styles.inlineEditorImage}" contenteditable="false" />`;
    }
    cursor = match.index + match[0].length;
  }

  html += escapeHtml(markdown.slice(cursor)).replace(/\n/g, "<br>");
  return html;
}

function editorToMarkdown(root: HTMLElement): string {
  const out: string[] = [];
  const blockTags = new Set(["DIV", "P", "LI", "UL", "OL", "PRE", "BLOCKQUOTE"]);

  function endsWithNewline() {
    const last = out[out.length - 1] ?? "";
    return last.endsWith("\n");
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push((node.textContent ?? "").replace(/\u00a0/g, " "));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;

    if (tag === "BR") {
      out.push("\n");
      return;
    }

    if (tag === "IMG" && el.dataset.inlineImage === "1") {
      const src = el.getAttribute("src")?.trim();
      if (src) {
        if (!endsWithNewline() && out.length > 0) out.push("\n");
        out.push(`![изображение](${src})`);
        out.push("\n");
      }
      return;
    }

    const isBlock = blockTags.has(tag);
    if (isBlock && !endsWithNewline() && out.length > 0) {
      out.push("\n");
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }

    if (isBlock && !endsWithNewline()) {
      out.push("\n");
    }
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child);
  }

  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

type EditProps = {
  editSlug?: string;
  initialTitle?: string;
  initialContent?: string;
  initialCategoryId?: string;
  initialTagIds?: string[];
  initialCoverUrl?: string | null;
};

export default function PostEditor({
  userId,
  categories: _categories,
  tags,
  editSlug,
  initialTitle = "",
  initialContent = "",
  initialCategoryId = "",
  initialTagIds = [],
  initialCoverUrl = null,
}: {
  userId: string;
  categories: Category[];
  tags: Tag[];
} & EditProps) {
  const router = useRouter();
  const ban = useBanRestriction();
  const postBlocked = ban.restricted;
  const editorRef = useRef<HTMLDivElement>(null);
  const wasContentModerationMirrorRef = useRef(false);
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [categoryId] = useState(initialCategoryId);
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [tagQuery, setTagQuery] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [availableTags, setAvailableTags] = useState<Tag[]>(tags);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverObjectUrl, setCoverObjectUrl] = useState<string | null>(null);
  const [useSteamCover, setUseSteamCover] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [error, setError] = useState("");
  const [modBlockPreview, setModBlockPreview] = useState<{
    sourceField?: string;
    text: string;
    matches: ModerationTextMatch[];
  } | null>(null);
  const [steamGame, setSteamGame] = useState<SteamGame | null>(null);

  const canSubmit = useMemo(() => {
    return title.trim().length > 0 && content.trim().length > 0 && !postBlocked;
  }, [title, content, postBlocked]);

  useEffect(() => {
    if (!coverFile) {
      setCoverObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const u = URL.createObjectURL(coverFile);
    setCoverObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return u;
    });
    return () => {
      URL.revokeObjectURL(u);
    };
  }, [coverFile]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = markdownToEditorHtml(initialContent);
  }, [initialContent]);

  useEffect(() => {
    const inMirror = modBlockPreview?.sourceField === "content";
    if (wasContentModerationMirrorRef.current && !inMirror) {
      const editor = editorRef.current;
      if (editor) editor.innerHTML = markdownToEditorHtml(content);
    }
    wasContentModerationMirrorRef.current = Boolean(inMirror);
  }, [modBlockPreview, content]);

  const effectiveCoverSrc = useMemo(() => {
    if (coverObjectUrl) return coverObjectUrl;
    if (useSteamCover && steamGame?.headerImage) return steamGame.headerImage;
    if (editSlug && initialCoverUrl && !coverFile) return initialCoverUrl;
    return null;
  }, [coverObjectUrl, useSteamCover, steamGame, initialCoverUrl, editSlug, coverFile]);

  function syncMarkdownFromEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    setContent(editorToMarkdown(editor));
  }

  function insertImageAtCaret(url: string) {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;

    let range: Range;
    if (selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    const img = document.createElement("img");
    img.src = url;
    img.alt = "изображение";
    img.dataset.inlineImage = "1";
    img.className = styles.inlineEditorImage;
    img.setAttribute("contenteditable", "false");

    const br = document.createElement("br");
    const spacer = document.createElement("br");

    range.deleteContents();
    range.insertNode(spacer);
    range.insertNode(br);
    range.insertNode(img);

    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    syncMarkdownFromEditor();
  }

  function appendImageToBottom(url: string) {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);

    const img = document.createElement("img");
    img.src = url;
    img.alt = "изображение";
    img.dataset.inlineImage = "1";
    img.className = styles.inlineEditorImage;
    img.setAttribute("contenteditable", "false");

    const brBefore = document.createElement("br");
    const brAfter = document.createElement("br");

    if (editor.textContent?.trim()) {
      range.insertNode(brBefore);
      range.setStartAfter(brBefore);
      range.collapse(true);
    }

    range.insertNode(brAfter);
    range.insertNode(img);

    range.setStartAfter(brAfter);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    syncMarkdownFromEditor();
  }

  function addTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function removeTag(id: string) {
    setTagIds((prev) => prev.filter((x) => x !== id));
  }

  useEffect(() => {
    let isMounted = true;

    async function loadTags() {
      try {
        const res = await fetch("/api/tags", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as Tag[] | null;
        if (!res.ok || !Array.isArray(data)) return;
        if (isMounted) {
          setAvailableTags(data);
        }
      } catch {
        // ignore network errors, keep initial tags
      }
    }

    void loadTags();
    return () => {
      isMounted = false;
    };
  }, []);

  function clearCustomCover() {
    setCoverFile(null);
  }

  function resetCoverToGame() {
    setCoverFile(null);
    setUseSteamCover(true);
  }

  async function uploadCover(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", "post");

    const res = await fetch("/api/upload", {
      method: "POST",
      body: fd,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || "Ошибка загрузки обложки");
    }

    return String(data.urls?.[0] || "");
  }

  async function uploadImages(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploadingImages(true);
    setError("");

    try {
      const fd = new FormData();
      Array.from(files).forEach((file) => {
        fd.append("files[]", file);
      });
      fd.append("type", "post");

      const res = await fetch("/api/upload", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Ошибка загрузки изображений");
      }

      const urls = Array.isArray(data.urls) ? data.urls : [];

      if (urls.length > 0) {
        for (const url of urls as string[]) {
          appendImageToBottom(url);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки изображений");
    } finally {
      setUploadingImages(false);
    }
  }

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text/plain")?.trim() ?? "";
      if (!text) return;
      const isImgUrl = /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(text);
      if (isImgUrl) {
        e.preventDefault();
        appendImageToBottom(text);
      }
    },
    []
  );

  async function ensureSteamCategoryId(game: SteamGame): Promise<string | null> {
    const qs = new URLSearchParams({ appid: String(game.appid) });
    let res = await fetch(`/api/categories/by-steam?${qs}`, { cache: "no-store" });
    let j = (await res.json()) as { category?: { id: string } | null; error?: string };
    if (j.category?.id) return j.category.id;
    res = await fetch("/api/categories/from-steam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appid: game.appid, name: game.name }),
    });
    j = (await res.json()) as { category?: { id: string }; error?: string };
    if (!res.ok) throw new Error(j.error || "Не удалось привязать категорию Steam");
    return j.category?.id ?? null;
  }

  async function submit() {
    if (!canSubmit) return;
    if (postBlocked) {
      setError("В бане нельзя публиковать и сохранять посты.");
      return;
    }

    setError("");
    setModBlockPreview(null);
    setIsLoading(true);

    try {
      let uploadedCover: string | null = null;

      if (coverFile) {
        uploadedCover = await uploadCover(coverFile);
      }

      let finalContent = content.trim();

      let coverImage: string | null;
      if (uploadedCover) {
        coverImage = uploadedCover;
      } else if (useSteamCover && steamGame?.headerImage) {
        coverImage = steamGame.headerImage;
      } else if (editSlug) {
        coverImage = initialCoverUrl ?? null;
      } else {
        coverImage = null;
      }

      let effectiveCategoryId: string | null = categoryId || null;
      if (steamGame) {
        const steamCat = await ensureSteamCategoryId(steamGame);
        if (steamCat) effectiveCategoryId = steamCat;
      }

      if (editSlug) {
        const res = await fetch(`/api/posts/${encodeURIComponent(editSlug)}`, {
          method: "PATCH",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            title: title.trim(),
            content: finalContent,
            categoryId: effectiveCategoryId,
            tagIds,
            coverImage: coverImage ?? null,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          matches?: unknown;
          post?: { slug?: string };
        };
        if (!res.ok) {
          const blocked = readModerationBlockedPayload(data);
          if (blocked) {
            const src = blocked.sourceField;
            const previewText = src === "title" ? title.trim() : finalContent;
            setModBlockPreview({
              sourceField: src === "title" || src === "content" ? src : "content",
              text: previewText,
              matches: blocked.matches,
            });
          }
          throw new Error(typeof data.error === "string" ? data.error : "Ошибка сохранения");
        }
        setModBlockPreview(null);
        const slug = data?.post?.slug ?? editSlug;
        emitPostRevisionRefresh({ slug });
        router.push(`/posts/${slug}`);
        router.refresh();
        window.setTimeout(() => emitPostRevisionRefresh({ slug }), 300);
        return;
      }

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          title: title.trim(),
          content: finalContent,
          categoryId: effectiveCategoryId,
          tagIds,
          isPublished: true,
          coverImage: uploadedCover || (useSteamCover ? steamGame?.headerImage : null) || null,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        matches?: unknown;
        post?: { slug?: string };
      };

      if (!res.ok) {
        const blocked = readModerationBlockedPayload(data);
        if (blocked) {
          const src = blocked.sourceField;
          const previewText = src === "title" ? title.trim() : finalContent;
          setModBlockPreview({
            sourceField: src === "title" || src === "content" ? src : "content",
            text: previewText,
            matches: blocked.matches,
          });
        }
        throw new Error(typeof data.error === "string" ? data.error : "Ошибка создания поста");
      }

      setModBlockPreview(null);

      if (!data?.post?.slug) {
        throw new Error("Сервер не вернул slug нового поста");
      }

      router.push(`/posts/${data.post.slug}`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Сетевая ошибка");
    } finally {
      setIsLoading(false);
    }
  }

  const selectedTags = useMemo(
    () => availableTags.filter((tag) => tagIds.includes(tag.id)),
    [availableTags, tagIds]
  );

  const filteredTagOptions = useMemo(() => {
    const pool = availableTags.filter((tag) => !tagIds.includes(tag.id));
    const needle = tagQuery.replace(/#/g, "").trim().toLowerCase();

    if (!needle) {
      return [...pool].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }

    const matches = pool.filter((tag) => tag.name.toLowerCase().includes(needle));

    matches.sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const aStarts = an.startsWith(needle) ? 0 : 1;
      const bStarts = bn.startsWith(needle) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name, "ru");
    });

    return matches;
  }, [tagQuery, availableTags, tagIds]);

  return (
    <div className={styles.editor}>
      {postBlocked ? (
        <div className={styles.banNotice} role="alert">
          <strong>Аккаунт в бане.</strong> Создавать и редактировать посты сейчас нельзя.
          {ban.permanent
            ? ""
            : ban.bannedUntilMs
              ? ` Осталось: ${formatBanCountdown(ban.remainingMs)}.`
              : ""}
        </div>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.mainColumn}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Основное</h2>

            <div className={styles.field}>
              <label className={styles.label}>Заголовок поста</label>
              {modBlockPreview?.sourceField === "title" ? (
                <ModerationBlockedMirrorInput
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setModBlockPreview(null);
                  }}
                  matches={modBlockPreview.matches}
                  shellClassName={styles.titleInputMirrorShell}
                  inputClassName={styles.titleInputMirrorInner}
                  placeholder="Например: Лучшие настройки для CS2"
                />
              ) : (
                <input
                  className={styles.input}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например: Лучшие настройки для CS2"
                />
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Текст поста</label>
              {modBlockPreview?.sourceField === "content" ? (
                <ModerationBlockedMirrorTextarea
                  wrapClassName=""
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setModBlockPreview(null);
                  }}
                  matches={modBlockPreview.matches}
                  shellClassName={styles.postBodyMirrorShell}
                  textareaClassName={styles.postBodyMirrorInner}
                  rows={14}
                  placeholder="Опиши тему, вопрос, мнение или гайд. Картинки вставляются кнопкой ниже после исправления текста."
                />
              ) : (
                <div
                  ref={editorRef}
                  className={styles.richEditor}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={() => syncMarkdownFromEditor()}
                  onPaste={onPaste}
                  data-placeholder="Опиши тему, вопрос, мнение или гайд. Вставляй картинки и пиши дальше в этом же поле."
                />
              )}
            </div>

            <div className={styles.uploadBlock}>
              <label className={styles.uploadButton}>
                <span>📷 Вставить в текст (на курсоре)</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className={styles.hiddenInput}
                  onChange={(e) => void uploadImages(e.target.files)}
                  disabled={uploadingImages || modBlockPreview?.sourceField === "content"}
                />
              </label>

              {uploadingImages ? (
                <span className={styles.uploadHint}>Загрузка изображений...</span>
              ) : modBlockPreview?.sourceField === "content" ? (
                <span className={styles.uploadHint}>
                  Пока открыто поле исправления блокировки, вставка картинок в текст отключена — исправьте текст, затем
                  снова появится обычный редактор.
                </span>
              ) : (
                <span className={styles.uploadHint}>
                  Вставленные изображения сразу показываются над полем текста. Можно писать дальше.
                </span>
              )}
            </div>
          </section>
        </div>

        <div className={styles.sideColumn}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Теги</h2>

            <div className={styles.field}>
              <label className={styles.label}>Выбор тегов</label>
              <div className={styles.tagPicker}>
                <input
                  className={styles.input}
                  value={tagQuery}
                  onFocus={() => setTagPickerOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setTagPickerOpen(false), 120);
                  }}
                  onChange={(e) => {
                    setTagQuery(e.target.value);
                    setTagPickerOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const first = filteredTagOptions[0];
                      if (first) {
                        addTag(first.id);
                        setTagQuery("");
                        setTagPickerOpen(true);
                      }
                    }
                  }}
                  placeholder="Начни вводить тег..."
                />

                {tagPickerOpen ? (
                  <div
                    className={styles.tagDropdown}
                    onMouseDown={(e) => e.preventDefault()}
                    role="listbox"
                    aria-label="Список тегов"
                  >
                    {filteredTagOptions.length ? (
                      filteredTagOptions.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className={styles.tagDropdownItem}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addTag(tag.id);
                            setTagQuery("");
                            setTagPickerOpen(true);
                          }}
                        >
                          #{tag.name}
                        </button>
                      ))
                    ) : tagQuery.replace(/#/g, "").trim() ? (
                      <div className={styles.tagDropdownEmpty}>
                        Нет совпадений. Выберите тег из существующего списка.
                      </div>
                    ) : (
                      <div className={styles.tagDropdownEmpty}>Теги не найдены</div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Выбранные теги</label>
              <div className={styles.tags}>
                {selectedTags.length ? (
                  selectedTags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => removeTag(tag.id)}
                      className={`${styles.tagButton} ${styles.tagButtonActive}`}
                      title="Убрать тег"
                    >
                      #{tag.name} ×
                    </button>
                  ))
                ) : (
                  <div className={styles.emptyTags}>Пока не выбрано ни одного тега.</div>
                )}
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Выбор игры</h2>

            <SteamGamePicker
              selectedGame={steamGame}
              onSelect={(game) => {
                setSteamGame(game);
                setUseSteamCover(true);
                if (game && !title.trim() && !editSlug) {
                  setTitle(game.name);
                }
              }}
            />
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Обложка</h2>
            <p className={styles.hintP}>
              Своя картинка перекрывает обложку игры. «На обложку игры» — снова картинка из Steam.
            </p>

            <div className={styles.field}>
              <label className={styles.label}>Выбор обложки</label>
              <label className={styles.filePickBtn}>
                <span>{coverFile ? "Обложка выбрана" : "Выбрать файл"}</span>
                <input
                  type="file"
                  accept="image/*"
                  className={styles.hiddenInput}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setCoverFile(f);
                    if (f) setUseSteamCover(false);
                  }}
                />
              </label>
            </div>

            <div className={styles.coverActions}>
              {coverFile ? (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => {
                    setCoverFile(null);
                    if (steamGame?.headerImage) {
                      setUseSteamCover(true);
                    }
                  }}
                >
                  Убрать свою, на обложку игры
                </button>
              ) : null}
              {steamGame?.headerImage ? (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={resetCoverToGame}
                >
                  Сбросить на Steam
                </button>
              ) : null}
            </div>

            {effectiveCoverSrc ? (
              <img
                src={effectiveCoverSrc}
                alt="Предпросмотр обложки"
                className={styles.preview}
              />
            ) : (
              <div className={styles.previewPlaceholder}>
                {steamGame ? "Можно выбрать обложку файла выше" : "Обложка появится при выборе игры Steam или файла"}
              </div>
            )}
          </section>

          <button
            type="button"
            disabled={isLoading || !canSubmit}
            onClick={() => void submit()}
            className={styles.submitButton}
          >
            {isLoading
              ? "Сохранение..."
              : editSlug
                ? "Сохранить изменения"
                : "Опубликовать пост"}
          </button>
        </div>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
