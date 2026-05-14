import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("транслитерирует кириллицу и заменяет пробелы на дефисы", () => {
    expect(slugify("  Привет Мир  ")).toBe("privet-mir");
  });

  it("убирает недопустимые символы и схлопывает дефисы", () => {
    expect(slugify("Test -- 123!!!")).toBe("test-123");
  });

  it("возвращает пустую строку для строки только из символов вне a-z0-9", () => {
    expect(slugify("!!!")).toBe("");
  });
});
