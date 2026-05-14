"use client";

import {
  forwardRef,
  useState,
  type ChangeEvent,
  type KeyboardEventHandler,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import type { ModerationTextMatch } from "@/lib/moderation/moderate-text";

const DEFAULT_TITLE = "Исправьте подчёркнутые слова:";

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

function renderHighlightedParts(text: string, spans: { start: number; end: number }[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let k = 0;
  for (const s of spans) {
    if (cursor < s.start) {
      parts.push(<span key={`t-${k++}`}>{text.slice(cursor, s.start)}</span>);
    }
    parts.push(
      <mark key={`m-${k++}`} className="moderation-blocked-word">
        {text.slice(s.start, s.end)}
      </mark>
    );
    cursor = s.end;
  }
  if (cursor < text.length) {
    parts.push(<span key={`t-${k++}`}>{text.slice(cursor)}</span>);
  }
  return parts;
}

type MirrorTextareaProps = {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  matches: ModerationTextMatch[];
  title?: string | false;
  wrapClassName?: string;
  shellClassName: string;
  textareaClassName: string;
  caretColor?: string;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  enterKeyHint?: TextareaHTMLAttributes<HTMLTextAreaElement>["enterKeyHint"];
  name?: string;
  autoFocus?: boolean;
};

export const ModerationBlockedMirrorTextarea = forwardRef<HTMLTextAreaElement, MirrorTextareaProps>(
  function ModerationBlockedMirrorTextarea(
    {
      value,
      onChange,
      matches,
      title = DEFAULT_TITLE,
      wrapClassName,
      shellClassName,
      textareaClassName,
      caretColor,
      rows = 4,
      disabled,
      placeholder,
      onKeyDown,
      enterKeyHint,
      name,
      autoFocus,
    },
    ref
  ) {
    const spans = mergeBlockSpans(matches);
    const [scrollTop, setScrollTop] = useState(0);

    if (!spans.length) {
      return (
        <textarea
          ref={ref}
          className={textareaClassName}
          value={value}
          onChange={onChange}
          rows={rows}
          disabled={disabled}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          enterKeyHint={enterKeyHint}
          name={name}
          autoFocus={autoFocus}
        />
      );
    }

    const head =
      title !== false ? (
        <div className="moderation-blocked-preview-title moderation-mirror-block-title">{title}</div>
      ) : null;

    return (
      <div className={wrapClassName ?? "moderation-blocked-field-wrap"}>
        {head}
        <div className={`moderation-mirror-shell ${shellClassName}`}>
          <div className="moderation-mirror-back-clip">
            <div
              className={`moderation-mirror-back-inner ${textareaClassName}`}
              style={{ transform: `translateY(-${scrollTop}px)` }}
            >
              {value.length ? (
                renderHighlightedParts(value, spans)
              ) : placeholder ? (
                <span className="moderation-mirror-placeholder-fg">{placeholder}</span>
              ) : null}
            </div>
          </div>
          <textarea
            ref={ref}
            className={`moderation-mirror-ta ${textareaClassName}`}
            value={value}
            onChange={onChange}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            rows={rows}
            disabled={disabled}
            placeholder={placeholder}
            onKeyDown={onKeyDown}
            enterKeyHint={enterKeyHint}
            name={name}
            autoFocus={autoFocus}
            spellCheck={false}
            style={caretColor ? { caretColor } : undefined}
          />
        </div>
      </div>
    );
  }
);

type MirrorInputProps = {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  matches: ModerationTextMatch[];
  title?: string | false;
  wrapClassName?: string;
  shellClassName: string;
  inputClassName: string;
  caretColor?: string;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
};

export const ModerationBlockedMirrorInput = forwardRef<HTMLInputElement, MirrorInputProps>(
  function ModerationBlockedMirrorInput(
    {
      value,
      onChange,
      matches,
      title = DEFAULT_TITLE,
      wrapClassName,
      shellClassName,
      inputClassName,
      caretColor,
      disabled,
      placeholder,
      name,
    },
    ref
  ) {
    const spans = mergeBlockSpans(matches);
    const [scrollLeft, setScrollLeft] = useState(0);

    if (!spans.length) {
      return (
        <input
          ref={ref}
          type="text"
          className={inputClassName}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          name={name}
        />
      );
    }

    const head =
      title !== false ? (
        <div className="moderation-blocked-preview-title moderation-mirror-block-title">{title}</div>
      ) : null;

    return (
      <div className={wrapClassName ?? "moderation-blocked-field-wrap"}>
        {head}
        <div className={`moderation-mirror-shell moderation-mirror-shell-input ${shellClassName}`}>
          <div className="moderation-mirror-back-clip">
            <div
              className={`moderation-mirror-back-inner moderation-mirror-back-inner-input ${inputClassName}`}
              style={{ transform: `translateX(-${scrollLeft}px)` }}
            >
              {value.length ? (
                renderHighlightedParts(value, spans)
              ) : placeholder ? (
                <span className="moderation-mirror-placeholder-fg">{placeholder}</span>
              ) : null}
            </div>
          </div>
          <input
            ref={ref}
            type="text"
            className={`moderation-mirror-input-el ${inputClassName}`}
            value={value}
            onChange={onChange}
            onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
            disabled={disabled}
            placeholder={placeholder}
            name={name}
            spellCheck={false}
            style={caretColor ? { caretColor } : undefined}
          />
        </div>
      </div>
    );
  }
);
