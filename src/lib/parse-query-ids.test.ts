import { describe, expect, it } from "vitest";
import { isUuidString, parseUuidList } from "./parse-query-ids";

const valid =
  "550e8400-e29b-41d4-a716-446655440000" as const;
const valid2 =
  "6ba7b810-9dad-11d1-80b4-00c04fd430c8" as const;

describe("isUuidString", () => {
  it("принимает корректный UUID v4", () => {
    expect(isUuidString(valid)).toBe(true);
  });

  it("отклоняет пустое и мусор", () => {
    expect(isUuidString("")).toBe(false);
    expect(isUuidString("not-a-uuid")).toBe(false);
    expect(isUuidString(undefined)).toBe(false);
  });
});

describe("parseUuidList", () => {
  it("разбирает список через запятую с лимитом", () => {
    expect(parseUuidList(`${valid},${valid2},bad`, 2)).toEqual([valid, valid2]);
  });

  it("возвращает пустой массив для пустой строки", () => {
    expect(parseUuidList("  ", 10)).toEqual([]);
  });
});
