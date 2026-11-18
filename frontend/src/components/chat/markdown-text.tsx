'use client';

import '@assistant-ui/react-markdown/styles/dot.css';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { TextMessagePartProps } from '@assistant-ui/react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import {
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
} from 'react';

// True while the answer sits under an open edit: the Markdown wrapper sets
// its own text color, so the muted color has to be applied here to reach the
// rendered answer text.
export const AnswerDimmedContext = createContext(false);

// True while the thinking indicator is shown or the stream is reconnecting:
// the assistant-ui pulse dot (dot.css) is suppressed then. dot.css is
// unlayered, so it beats layered utilities; the important modifier wins.
export const HideAnswerPulseContext = createContext(false);

export function MarkdownText({
  source,
  ...props
}: Partial<TextMessagePartProps> & { readonly source?: string }) {
  const dimmed = useContext(AnswerDimmedContext);
  const hidePulse = useContext(HideAnswerPulseContext);
  const wrapperClass = `aui-md ${dimmed ? 'text-muted-foreground' : 'text-foreground'} max-w-none flex flex-col gap-3${hidePulse ? ' after:content-none! [&_*]:after:content-none!' : ''}`;
  // Everything inside a dimmed answer is muted, not only the wrapper text:
  // bold text, headings, list markers, and links carry the color themselves.
  const muted = dimmed && 'text-muted-foreground';
  const markerMuted = dimmed && 'marker:text-muted-foreground';
  const components: Components = {
    img: () => null,
    h1: ({ children }) => (
      <h1
        className={cn('mt-1.5 mb-1 text-base font-semibold font-sans', muted)}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className={cn('mt-1.5 mb-1 text-base font-semibold font-sans', muted)}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className={cn('mt-1.5 mb-1 text-base font-semibold font-sans', muted)}
      >
        {children}
      </h3>
    ),
    p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
      <p className="mb-2">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mb-2 ps-[22px] list-disc">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2 ps-[22px] list-decimal">{children}</ol>
    ),
    strong: ({ children }) => (
      <strong className={cn('font-semibold', muted)}>{children}</strong>
    ),
    li: ({ children }) => (
      <li className={cn('my-[3px]', markerMuted)}>{children}</li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-border text-muted-foreground my-4 border-s-2 ps-4">
        {children}
      </blockquote>
    ),
    a: ({ children, href, ...attributes }: ComponentPropsWithoutRef<'a'>) =>
      href === undefined ? (
        <>{children}</>
      ) : (
        <a
          {...attributes}
          href={href}
          rel="noreferrer noopener"
          target="_blank"
          className={cn('underline underline-offset-2', muted)}
        >
          {children}
        </a>
      ),
  };
  if (source !== undefined)
    return (
      <div className={wrapperClass}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {source}
        </ReactMarkdown>
      </div>
    );
  return (
    <MarkdownTextPrimitive
      {...props}
      remarkPlugins={[remarkGfm]}
      components={components}
      className={wrapperClass}
      defer
    />
  );
}
