import Image from "next/image";

// Intrinsic aspect ratio of the wordmark SVGs (viewBox height / width). Every mark and the monogram are square.
const WORDMARK_RATIO = 472 / 1631;

type Tone = "seal" | "ink" | "midnight" | "parchment";

type Props = {
  /**
   * "wordmark"    full Lexon logo (the compact version is chosen automatically below 200 px)
   * "monogram"    the three-pillar L on its own
   * "mark-circle" | "mark-square" | "mark-tile"  the L inside a circle, a square or a rounded square
   */
  variant?: "wordmark" | "monogram" | "mark-circle" | "mark-square" | "mark-tile";
  /** Wordmark and monogram: use the cream artwork on dark backgrounds. */
  inverse?: boolean;
  /** Marks only: background tone. seal (default), ink and midnight carry a cream L; parchment carries a seal L. */
  tone?: Tone;
  /** Rendered width in CSS px. Minimums: wordmark 200 (compact 128), monogram 64 (small 40, micro 16), marks 16. */
  width?: number;
  className?: string;
};

export function LexonLogo({ variant = "wordmark", inverse = false, tone = "seal", width = 200, className = "" }: Props) {
  const color = inverse ? "cream" : "ink";
  // Size tiers. Below 200 px the wordmark switches to the compact version (three fine pillars).
  // Monogram and marks switch to the small version (three fine pillars) below 64 px and to the micro version (single stem) below 40 px.
  const tier = width < 40 ? "-micro" : width < 64 ? "-small" : "";
  let src: string;
  let height: number;
  if (variant === "wordmark") {
    src = `/LEXON-wordmark${width < 200 ? "-compact" : ""}-${color}.svg`;
    height = Math.round(width * WORDMARK_RATIO);
  } else if (variant === "monogram") {
    src = `/LEXON-monogram${tier}-${color}.svg`;
    height = width;
  } else {
    src = `/LEXON-${variant}-${tone}${tier}.svg`;
    height = width;
  }
  return <Image src={src} alt="Lexon" width={width} height={height} className={className} priority />;
}
