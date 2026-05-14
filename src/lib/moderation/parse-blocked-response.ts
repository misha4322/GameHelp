import type { ModerationTextMatch } from "./moderate-text";

export function readModerationBlockedPayload(data: unknown): {
  matches: ModerationTextMatch[];
  sourceField?: string;
} | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.code !== "MODERATION_BLOCKED") return null;
  if (!Array.isArray(o.matches)) return null;

  const matches: ModerationTextMatch[] = [];
  for (const item of o.matches) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (
      typeof m.ruleId === "string" &&
      typeof m.start === "number" &&
      typeof m.end === "number" &&
      typeof m.text === "string" &&
      (m.action === "block" || m.action === "censor") &&
      (m.severity === "low" || m.severity === "medium" || m.severity === "high")
    ) {
      matches.push({
        ruleId: m.ruleId,
        phrase: typeof m.phrase === "string" ? m.phrase : "",
        maskedPhrase: typeof m.maskedPhrase === "string" ? m.maskedPhrase : "",
        action: m.action,
        severity: m.severity,
        start: m.start,
        end: m.end,
        text: m.text,
      });
    }
  }
  if (!matches.length) return null;
  const sourceField = typeof o.sourceField === "string" ? o.sourceField : undefined;
  return { matches, sourceField };
}
