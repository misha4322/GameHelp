import { readFile } from "node:fs/promises";

import { db } from "@/server/db";
import { moderationWords } from "@/server/db/schema";
import { normalizeForModeration } from "@/lib/moderation/normalize";

function splitPhrases(raw: string): string[] {
  return raw
    .split(/[\r\n,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const file = process.argv[2]?.trim();
  if (!file) {
    throw new Error("Usage: tsx scripts/import-moderation-words.ts <path-to-txt>");
  }

  const raw = await readFile(file, "utf8");
  const parts = splitPhrases(raw);

  const uniqueByNormalized = new Map<string, string>();
  for (const phrase of parts) {
    const normalized = normalizeForModeration(phrase);
    if (!normalized) continue;
    if (!uniqueByNormalized.has(normalized)) uniqueByNormalized.set(normalized, phrase);
  }

  const normalizedList = Array.from(uniqueByNormalized.keys());
  const existing = await db.query.moderationWords.findMany({
    columns: { normalizedPhrase: true },
  });
  const existingSet = new Set(existing.map((r) => r.normalizedPhrase));

  const now = new Date();
  const toInsert = normalizedList
    .filter((n) => !existingSet.has(n))
    .map((normalized) => ({
      phrase: uniqueByNormalized.get(normalized)!,
      normalizedPhrase: normalized,
      action: "block" as const,
      scope: "all" as const,
      severity: "high" as const,
      replacement: "***",
      isActive: true,
      createdById: null,
      updatedById: null,
      createdAt: now,
      updatedAt: now,
    }));

  if (toInsert.length > 0) {
    await db.insert(moderationWords).values(toInsert);
  }

  // Не печатаем сами фразы — только статистику
  console.log(
    JSON.stringify(
      {
        received: parts.length,
        normalized: normalizedList.length,
        inserted: toInsert.length,
        skippedExisting: normalizedList.length - toInsert.length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

