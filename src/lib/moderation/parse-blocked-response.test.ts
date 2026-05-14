import { describe, expect, it } from "vitest";
import { readModerationBlockedPayload } from "./parse-blocked-response";

const goodMatch = {
  ruleId: "r1",
  phrase: "x",
  maskedPhrase: "",
  action: "block" as const,
  severity: "high" as const,
  start: 0,
  end: 1,
  text: "x",
};

describe("readModerationBlockedPayload", () => {
  it("возвращает null для неподходящих данных", () => {
    expect(readModerationBlockedPayload(null)).toBeNull();
    expect(readModerationBlockedPayload({ code: "OTHER" })).toBeNull();
    expect(readModerationBlockedPayload({ code: "MODERATION_BLOCKED", matches: [] })).toBeNull();
  });

  it("разбирает валидный ответ модерации", () => {
    const out = readModerationBlockedPayload({
      code: "MODERATION_BLOCKED",
      sourceField: "body",
      matches: [goodMatch],
    });
    expect(out).not.toBeNull();
    expect(out!.matches).toHaveLength(1);
    expect(out!.matches[0]!.ruleId).toBe("r1");
    expect(out!.sourceField).toBe("body");
  });
});
