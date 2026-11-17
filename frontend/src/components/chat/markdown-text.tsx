'use client';

import '@assistant-ui/react-markdown/styles/dot.css';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { TextMessagePartProps } from '@assistant-ui/react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  const wrapperClass = `aui-md ${dimmed ? 'text-muted-foreground' : 'text-foreground'} max-w-none${hidePulse ? ' after:content-none! [&_*]:after:content-none!' : ''}`;
  const components: Components = {
    img: () => null,
    h1: ({ children }) => (
      <h1 className="mt-6 mb-3 text-2xl font-semibold font-sans tracking-tight first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-6 mb-3 text-xl font-semibold font-sans tracking-tight first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-5 mb-2 text-lg font-semibold font-sans tracking-tight first:mt-0">
        {children}
      </h3>
    ),
    p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
      <p className="my-3 first:mt-0 last:mb-0">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="my-3 ms-6 list-disc space-y-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 ms-6 list-decimal space-y-1">{children}</ol>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    li: ({ children }) => <li className="ps-1">{children}</li>,
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
          className="underline underline-offset-2"
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
