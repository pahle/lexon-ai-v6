import { MARKS } from './indicator-geometry';

/**
 * The static filled Lexon monogram (brand micro tier, one middle bar). The
 * shapes come from MARKS.lexon so the animated indicator finishes on exactly
 * this mark. No hooks, no effects. The color is the caller's `currentColor`.
 */
export function LexonMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      {MARKS.lexon.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
