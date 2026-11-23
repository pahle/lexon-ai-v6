/**
 * RFC 9110 §13.1.2 weak comparison for If-None-Match: a comma-separated
 * entity-tag list, the `W/` prefix ignored on both sides, `*` matching any
 * current tag. An absent or empty header never matches.
 */
export function weakMatch(
  ifNoneMatch: string | undefined,
  etag: string,
): boolean {
  if (ifNoneMatch === undefined) return false;
  const stripWeak = (tag: string) =>
    tag.startsWith('W/') ? tag.slice(2) : tag;
  const target = stripWeak(etag.trim());
  return ifNoneMatch.split(',').some((candidate) => {
    const value = candidate.trim();
    if (value === '*') return true;
    if (value === '') return false;
    return stripWeak(value) === target;
  });
}
