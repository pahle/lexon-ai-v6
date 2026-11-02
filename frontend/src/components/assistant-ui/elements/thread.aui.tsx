'use client';

import { ComposerPrimitive, ThreadPrimitive } from '@assistant-ui/react';

export function Thread({ displayName }: { displayName: string }) {
  return (
    <section aria-label="Chat" className="flex min-h-0 flex-1 flex-col gap-6">
      <p className="text-[length:var(--font-size-heading)] font-semibold">
        Welcome, {displayName}
      </p>
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <ThreadPrimitive.Viewport className="min-h-0 flex-1">
          <ThreadPrimitive.Messages>
            {({ message }) => (
              <article className="my-4 w-full text-sm leading-7">
                {message.content.map((part, index) =>
                  part.type === 'text' ? (
                    <p key={`${message.id}-${index}`}>{part.text}</p>
                  ) : null,
                )}
              </article>
            )}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Chat is not available yet.
          </p>
          <ComposerPrimitive.Root
            tabIndex={-1}
            onSubmitCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            className="flex min-h-11 rounded-sm border border-border bg-background p-2"
          >
            <ComposerPrimitive.Input
              aria-label="Chat message"
              disabled
              submitMode="none"
              placeholder="Chat is not available yet."
              className="min-h-11 min-w-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
    </section>
  );
}
