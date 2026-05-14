import { describe, expect, it } from "vitest";
import { MAX_MODERATION_TEXT_CHARS, clampModerationText } from "./moderation-text-limit";

describe("clampModerationText", () => {
  it("не режет текст короче лимита", () => {
    expect(clampModerationText("abc")).toBe("abc");
  });

  it("обрезает до max символов", () => {
    const long = "x".repeat(MAX_MODERATION_TEXT_CHARS + 40);
    expect(clampModerationText(long).length).toBe(MAX_MODERATION_TEXT_CHARS);
  });
});
