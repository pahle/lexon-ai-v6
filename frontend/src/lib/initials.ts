/** First letters of the first two words, upper-cased by locale; "?" if empty. */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => String.fromCodePoint(word.codePointAt(0)!));
  return letters.length > 0 ? letters.join('').toLocaleUpperCase() : '?';
}
