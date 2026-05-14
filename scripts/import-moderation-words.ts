import { readFile } from "node:fs/promises";

import { MIN_MODERATION_PHRASE_CHARS } from "@/lib/moderation/moderate-text";
import { normalizeForModeration } from "@/lib/moderation/normalize";
import { db } from "@/server/db";
import { moderationWords, type ModerationAction, type ModerationScope, type ModerationSeverity } from "@/server/db/schema";

function splitPhrases(raw: string): string[] {
  return raw
    .split(/[\r\n,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

type CliOptions = {
  file: string;
  action: ModerationAction;
  scope: ModerationScope;
  severity: ModerationSeverity;
  replacement: string;
};

function parseArgs(argv: string[]): CliOptions | { error: string } {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        return { error: `Ожидалось значение после --${key}` };
      }
      flags.set(key, next);
      i++;
    } else {
      positional.push(a);
    }
  }

  const file = positional[0]?.trim();
  if (!file) {
    return {
      error:
        "Usage: tsx scripts/import-moderation-words.ts <file.txt> --action censor|block --scope all|posts|... --severity low|medium|high [--replacement ...]",
    };
  }

  const actionRaw = flags.get("action")?.toLowerCase();
  if (actionRaw !== "censor" && actionRaw !== "block") {
    return { error: "Нужен --action censor или --action block" };
  }

  const scopeRaw = flags.get("scope")?.toLowerCase();
  const scopes: ModerationScope[] = ["all", "posts", "comments", "messages", "profile"];
  if (!scopeRaw || !scopes.includes(scopeRaw as ModerationScope)) {
    return { error: "Нужен --scope: all | posts | comments | messages | profile" };
  }

  const sevRaw = flags.get("severity")?.toLowerCase();
  const sevs: ModerationSeverity[] = ["low", "medium", "high"];
  if (!sevRaw || !sevs.includes(sevRaw as ModerationSeverity)) {
    return { error: "Нужен --severity: low | medium | high" };
  }

  let action: ModerationAction = actionRaw;
  let severity: ModerationSeverity = sevRaw as ModerationSeverity;
  if (action === "block") {
    severity = "high";
  } else if (severity === "high") {
    severity = "medium";
  }

  const replacement = flags.get("replacement")?.trim() || "...";

  return {
    file,
    action,
    scope: scopeRaw as ModerationScope,
    severity,
    replacement,
  };
}

async function main() {
  const parsed = parseArgs(process.argv);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  const { file, action, scope, severity, replacement } = parsed;

  const raw = await readFile(file, "utf8");
  const parts = splitPhrases(raw);

  const uniqueByNormalized = new Map<string, string>();
  for (const phrase of parts) {
    const normalized = normalizeForModeration(phrase);
    if (!normalized || normalized.length < MIN_MODERATION_PHRASE_CHARS) continue;
    if (!uniqueByNormalized.has(normalized)) {
      uniqueByNormalized.set(normalized, phrase);
    }
  }

  const normalizedList = Array.from(uniqueByNormalized.keys());
  const existing = await db.query.moderationWords.findMany({
    columns: { normalizedPhrase: true, scope: true },
  });
  const existingSet = new Set(existing.map((r) => `${r.normalizedPhrase}\t${r.scope}`));

  const now = new Date();
  const toInsert = normalizedList
    .filter((n) => !existingSet.has(`${n}\t${scope}`))
    .map((normalized) => ({
      phrase: uniqueByNormalized.get(normalized)!,
      normalizedPhrase: normalized,
      action,
      scope,
      severity,
      replacement,
      isActive: true,
      createdById: null,
      updatedById: null,
      createdAt: now,
      updatedAt: now,
    }));

  if (toInsert.length > 0) {
    await db.insert(moderationWords).values(toInsert);
  }

  console.log(
    JSON.stringify(
      {
        file,
        action,
        scope,
        severity,
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
