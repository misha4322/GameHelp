/**
 * Безопасный превью фрагмента поста для админки: markdown-картинки → <img>, переносы, **жирный**.
 * Не полноценный Markdown — только то, что нужно для обзора жалоб.
 */
export function markdownPostFragmentToHtml(markdown: string): string {
  const src = String(markdown ?? "");
  if (!src.trim()) return "";

  function esc(s: string) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTextChunk(s: string): string {
    let t = esc(s);
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\n/g, "<br />");
    return t;
  }

  const re = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      out += formatTextChunk(src.slice(last, m.index));
    }
    const alt = m[1] ?? "";
    const url = (m[2] ?? "").trim();
    if (/^https?:\/\//i.test(url)) {
      out += `<span class="report-drawer-md-img-wrap"><img src="${esc(url)}" alt="${esc(alt)}" class="report-drawer-inline-img" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>`;
    } else {
      out += formatTextChunk(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    out += formatTextChunk(src.slice(last));
  }
  return out;
}
