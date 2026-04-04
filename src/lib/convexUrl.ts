export function normalizeConvexUrl(rawUrl?: string): string | undefined {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}
