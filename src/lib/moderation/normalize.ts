const LATIN_TO_CYRILLIC: Record<string, string> = {
  a: "а",
  e: "е",
  o: "о",
  p: "р",
  c: "с",
  x: "х",
  y: "у",
  k: "к",
  m: "м",
  t: "т",
  h: "н",
  b: "в",
};

const STRIP_INSIDE_WORD = /[.,\-_ \t*\/\\]+/g;
const MULTI_SPACE = /\s+/g;

function mapLatinLookalikes(input: string): string {
  let out = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    out += LATIN_TO_CYRILLIC[lower] ?? ch;
  }
  return out;
}

function collapseRepeats(input: string): string {
  if (input.length < 3) return input;
  let out = input[0] ?? "";
  for (let i = 1; i < input.length; i++) {
    const prev = out[out.length - 1];
    const cur = input[i]!;
    if (cur === prev) continue;
    out += cur;
  }
  return out;
}

function keepOnlyCyrillicDigitsSpace(input: string): string {
  // keep: а-я, ё, 0-9, space
  return input.replace(/[^0-9а-яё\s]+/gi, " ");
}

export function normalizeForModeration(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";

  const lowered = trimmed.toLowerCase().replaceAll("ё", "е");
  const mapped = mapLatinLookalikes(lowered);
  const kept = keepOnlyCyrillicDigitsSpace(mapped);
  const spaced = kept.replace(MULTI_SPACE, " ").trim();

  // Remove separators inside "words" (we treat spaces as separators too for matching phrases).
  const joined = spaced.replace(STRIP_INSIDE_WORD, "");

  return collapseRepeats(joined);
}

export function maskModerationPhrase(input: string): string {
  const s = String(input ?? "").trim();
  if (s.length < 4) return "***";
  const first = s[0] ?? "*";
  const last = s[s.length - 1] ?? "*";
  if (!first || !last) return "***";
  return `${first}***${last}`;
}
