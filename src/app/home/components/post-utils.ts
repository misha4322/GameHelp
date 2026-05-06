export function normalizePostPreview(text: string) {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function getExcerpt(text: string, max = 140) {
  const normalized = normalizePostPreview(text);

  if (!normalized) {
    return "";
  }

  return normalized.length > max
    ? `${normalized.slice(0, max).trim()}...`
    : normalized;
}
