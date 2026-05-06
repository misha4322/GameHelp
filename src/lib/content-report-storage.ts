import type { CommentReportReasonCategory } from "@/server/db/schema";

import { COMMENT_REPORT_CATEGORY_LABEL } from "./comment-report-labels";

const PREFIX_RE = /^\[report_cat:(insult|hate|spam|custom)\]\n([\s\S]*)$/;

/** Префикс в начале reason — чтобы админка показывала категорию без колонки БД */
export function tagCommentReportReason(
  category: CommentReportReasonCategory,
  body: string
): string {
  return `[report_cat:${category}]\n${body}`;
}

export function parseTaggedCommentReportReason(reason: string | null): {
  category: CommentReportReasonCategory | null;
  body: string;
  categoryLabel: string | null;
} {
  if (!reason?.trim()) {
    return { category: null, body: "", categoryLabel: null };
  }
  const m = reason.match(PREFIX_RE);
  if (!m) {
    return { category: null, body: reason, categoryLabel: null };
  }
  const cat = m[1] as CommentReportReasonCategory;
  const body = m[2];
  const categoryLabel =
    cat in COMMENT_REPORT_CATEGORY_LABEL ? COMMENT_REPORT_CATEGORY_LABEL[cat] : cat;
  return { category: cat, body, categoryLabel };
}
