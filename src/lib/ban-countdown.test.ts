import { describe, expect, it } from "vitest";
import { formatBanCountdown } from "./ban-countdown";

describe("formatBanCountdown", () => {
  it("ноль миллисекунд даёт 00:00:00", () => {
    expect(formatBanCountdown(0)).toBe("00:00:00");
  });

  it("отрицательное время трактуется как истёкшее (00:00:00)", () => {
    expect(formatBanCountdown(-5000)).toBe("00:00:00");
  });
});
