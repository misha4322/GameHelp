import { describe, expect, it } from "vitest";
import { buildStoredCommentReportText } from "./comment-report-labels";

describe("buildStoredCommentReportText", () => {
  it("для custom возвращает только текст заявителя", () => {
    expect(buildStoredCommentReportText("custom", "  мой текст  ")).toBe("мой текст");
  });

  it("для пресета добавляет заголовок и блок «Дополнительно»", () => {
    const s = buildStoredCommentReportText("spam", "ссылка в личку");
    expect(s).toContain("Спам");
    expect(s).toContain("Дополнительно от заявителя: ссылка в личку");
  });
});
