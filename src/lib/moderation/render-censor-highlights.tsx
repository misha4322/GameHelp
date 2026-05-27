import type { ReactNode } from "react";

import type { ModerationChangeDto } from "./preview-api";

function mergeChangeSpans(changes: ModerationChangeDto[]) {
  const sorted = [...changes].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number; replacement: string }[] = [];
  for (const c of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && c.start <= prev.end) {
      prev.end = Math.max(prev.end, c.end);
      if (c.replacement) prev.replacement = c.replacement;
    } else {
      merged.push({
        start: c.start,
        end: c.end,
        replacement: c.replacement,
      });
    }
  }
  return merged;
}

/** Подсветка заменённых фрагментов в исходном тексте. */
export function renderOriginalWithCensorMarks(
  text: string,
  changes: ModerationChangeDto[]
): ReactNode[] {
  const spans = mergeChangeSpans(changes);
  if (!spans.length) return [text];

  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const s of spans) {
    if (cursor < s.start) {
      parts.push(<span key={`t-${key++}`}>{text.slice(cursor, s.start)}</span>);
    }
    parts.push(
      <mark key={`m-${key++}`} className="moderation-censor-word">
        {text.slice(s.start, s.end)}
      </mark>
    );
    cursor = s.end;
  }
  if (cursor < text.length) {
    parts.push(<span key={`t-${key++}`}>{text.slice(cursor)}</span>);
  }
  return parts;
}

/** Текст после модерации: вставки замен там, где были запрещённые слова. */
export function renderCleanTextPreview(
  original: string,
  clean: string,
  changes: ModerationChangeDto[]
): ReactNode {
  if (!changes.length) {
    return <span>{clean}</span>;
  }

  const spans = mergeChangeSpans(changes);
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let cleanCursor = 0;

  for (const s of spans) {
    if (cursor < s.start) {
      const chunk = original.slice(cursor, s.start);
      const cleanChunk = clean.slice(cleanCursor, cleanCursor + chunk.length);
      parts.push(<span key={`o-${key++}`}>{cleanChunk || chunk}</span>);
      cleanCursor += (cleanChunk || chunk).length;
    }
    const replacement =
      clean.slice(
        cleanCursor,
        cleanCursor + (s.replacement || "...").length
      ) || s.replacement || "...";
    parts.push(
      <mark key={`c-${key++}`} className="moderation-censor-replacement">
        {replacement}
      </mark>
    );
    cleanCursor += replacement.length;
    cursor = s.end;
  }

  if (cleanCursor < clean.length) {
    parts.push(<span key={`tail-${key++}`}>{clean.slice(cleanCursor)}</span>);
  } else if (cursor < original.length) {
    parts.push(<span key={`tail-${key++}`}>{original.slice(cursor)}</span>);
  }

  return <>{parts}</>;
}
