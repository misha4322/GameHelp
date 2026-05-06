import type { CommentReportReasonCategory } from "@/server/db/schema";

export const COMMENT_REPORT_PRESETS: {
  id: CommentReportReasonCategory;
  title: string;
  description: string;
}[] = [
  {
    id: "insult",
    title: "Оскорбления и личные нападки",
    description:
      "Унижение, травля, угрозы, оскорбления по личным признакам, домогательства.",
  },
  {
    id: "hate",
    title: "Разжигание ненависти и дискриминация",
    description:
      "Призывы к насилию, дискриминация по признакам расы, религии, национальности, ориентации и т.п.",
  },
  {
    id: "spam",
    title: "Спам, реклама и флуд",
    description: "Реклама без пометки, повторяющиеся сообщения, оффтоп, мусор.",
  },
];

export const COMMENT_REPORT_CATEGORY_LABEL: Record<CommentReportReasonCategory, string> = {
  insult: COMMENT_REPORT_PRESETS[0].title,
  hate: COMMENT_REPORT_PRESETS[1].title,
  spam: COMMENT_REPORT_PRESETS[2].title,
  custom: "Свой вариант",
};

export function buildStoredCommentReportText(
  category: CommentReportReasonCategory,
  extraDetail: string
): string {
  const detail = extraDetail.trim();
  if (category === "custom") {
    return detail;
  }
  const title = COMMENT_REPORT_CATEGORY_LABEL[category];
  if (!detail) return title;
  return `${title}\n\nДополнительно от заявителя: ${detail}`;
}
