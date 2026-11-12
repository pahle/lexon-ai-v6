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
    p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
      <p className="my-3 first:mt-0 last:mb-0">{children}</p>
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
