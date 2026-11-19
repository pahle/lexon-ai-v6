import Image from 'next/image';

// Brand v4.1 marks (docs/brand/lexon-2026-v4.1/logo). The word "Lexon" as a
// logo always comes from these SVGs, never from a live font (LEX-DS-001 §4).

// Intrinsic aspect ratio of the wordmark SVGs (viewBox height / width).
const WORDMARK_RATIO = 472 / 1631;

type Props = {
  /**
   * "monogram"          the L on its own, always Merah Segel red
   * "wordmark-compact"  the wordmark for widths under 200 px (auth pages use 96, 88 on mobile)
   * "wordmark"          the full wordmark, ink only, for 200 px and wider
   */
  variant?: 'monogram' | 'wordmark-compact' | 'wordmark';
  /** Compact wordmark only: ink on light surfaces, white on Night or dark surfaces. */
  tone?: 'ink' | 'white';
  /** Rendered width in CSS px. */
  width?: number;
  /** Pass an empty string for a decorative copy next to another named logo. */
  alt?: string;
  className?: string;
};

export function LexonLogo({
  variant = 'wordmark-compact',
  tone = 'ink',
  width = 128,
  alt = 'Lexon',
  className = '',
}: Props) {
  const src =
    variant === 'monogram'
      ? '/LEXON-monogram-micro-seal.svg'
      : variant === 'wordmark'
        ? '/LEXON-wordmark-ink.svg'
        : `/LEXON-wordmark-compact-${tone}.svg`;
  const height =
    variant === 'monogram' ? width : Math.round(width * WORDMARK_RATIO);
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority
    />
  );
}
