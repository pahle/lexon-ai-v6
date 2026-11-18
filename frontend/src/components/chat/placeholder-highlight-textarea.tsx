'use client';

import { forwardRef, useRef, type ComponentProps } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const PLACEHOLDER = /\[[^\][\n]+\]/g;

/** The text split into plain runs and `[placeholder]` runs, in order. */
function split(text: string) {
  const parts: { readonly text: string; readonly mark: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (match.index > last)
      parts.push({ text: text.slice(last, match.index), mark: false });
    parts.push({ text: match[0], mark: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mark: false });
  return parts;
}

/**
 * The new-chat composer field. A textarea cannot style a part of its own text,
 * so each `[placeholder]` is highlighted by a mirror: an aria-hidden layer
 * behind the real textarea that repeats the text with the same box and font and
 * draws only the highlight (`muted`, radius 4px). The textarea stays the single
 * accessible control: it keeps focus, selection, caret, IME and autosizing, and
 * its background is transparent so the mirror shows through. The textarea text is
 * transparent and the mirror draws the visible text (placeholders in
 * `muted-foreground`); a highlight's 4px side padding is cancelled by a
 * negative margin, so the mirror never shifts a glyph away from the textarea's.
 */
export const PlaceholderHighlightTextarea = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<typeof Textarea> & { readonly value: string }
>(({ value, className, onScroll, ...props }, ref) => {
  const mirror = useRef<HTMLDivElement>(null);
  return (
    <div className="relative w-full">
      <div
        ref={mirror}
        aria-hidden="true"
        data-slot="placeholder-mirror"
        className="pointer-events-none absolute inset-0 overflow-hidden p-1 text-base leading-[normal] break-words whitespace-pre-wrap"
      >
        {split(value).map((part, index) =>
          part.mark ? (
            <span
              key={index}
              data-slot="placeholder-mark"
              className="bg-muted text-muted-foreground -mx-1 rounded-[4px] px-1 py-px"
            >
              {part.text}
            </span>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
        {value.endsWith('\n') ? '\u200b' : null}
      </div>
      <Textarea
        ref={ref}
        value={value}
        className={cn(
          'caret-foreground relative text-transparent selection:bg-primary/20',
          className,
        )}
        onScroll={(event) => {
          if (mirror.current)
            mirror.current.scrollTop = event.currentTarget.scrollTop;
          onScroll?.(event);
        }}
        {...props}
      />
    </div>
  );
});
PlaceholderHighlightTextarea.displayName = 'PlaceholderHighlightTextarea';
