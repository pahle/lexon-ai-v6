'use client';

import '@assistant-ui/react-markdown/styles/dot.css';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { TextMessagePartProps } from '@assistant-ui/react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentPropsWithoutRef } from 'react';

export function MarkdownText({
  source,
  ...props
}: Partial<TextMessagePartProps> & { readonly source?: string }) {
  const components: Components = {
    img: () => null,
    h1: ({ children }) => (
      <h1 className="mt-6 mb-3 text-2xl font-semibold tracking-tight first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-6 mb-3 text-xl font-semibold tracking-tight first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-5 mb-2 text-lg font-semibold tracking-tight first:mt-0">
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
      <div className="aui-md text-foreground max-w-none leading-relaxed">
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
      className="aui-md text-foreground max-w-none leading-relaxed"
      defer
    />
  );
}
