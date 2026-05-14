"use client";

import type { ModerationTextMatch } from "@/lib/moderation/moderate-text";

function mergeBlockSpans(matches: ModerationTextMatch[]) {
  const block = matches.filter((m) => m.action === "block");
  const sorted = [...block].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const m of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && m.start <= prev.end) {
      prev.end = Math.max(prev.end, m.end);
    } else {
      merged.push({ start: m.start, end: m.end });
    }
  }
  return merged;
}

export default function ModerationBlockedPreview({
  text,
  matches,
}: {
  text: string;
  matches: ModerationTextMatch[];
}) {
  const spans = mergeBlockSpans(matches);
  if (!spans.length) return null;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const s of spans) {
    if (cursor < s.start) {
      parts.push(<span key={`t-${key++}`}>{text.slice(cursor, s.start)}</span>);
    }
    parts.push(
      <mark key={`m-${key++}`} className="moderation-blocked-word">
        {text.slice(s.start, s.end)}
      </mark>
    );
    cursor = s.end;
  }
  if (cursor < text.length) {
    parts.push(<span key={`t-${key++}`}>{text.slice(cursor)}</span>);
  }

  return (
    <div className="moderation-blocked-preview" role="status">
      <div className="moderation-blocked-preview-title">Исправьте подчёркнутые слова:</div>
      <div className="moderation-blocked-preview-body">{parts}</div>
    </div>
  );
}
