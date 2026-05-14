import { describe, expect, it } from "vitest";
import { maskModerationPhrase, normalizeForModeration } from "./normalize";

describe("normalizeForModeration", () => {
  it("пустая и пробельная строка дают пустую нормализацию", () => {
    expect(normalizeForModeration("")).toBe("");
    expect(normalizeForModeration("   \t  ")).toBe("");
  });
});

describe("maskModerationPhrase", () => {
  it("короткая фраза полностью скрыта, длинная — первый и последний символ", () => {
    expect(maskModerationPhrase("ab")).toBe("...");
    expect(maskModerationPhrase("слово")).toBe("с...о");
  });
});
