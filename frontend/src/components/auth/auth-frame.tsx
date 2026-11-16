import type { ReactElement, ReactNode } from 'react';
import { LexonLogo } from '../lexon-logo';

// Owner decision 2026-11-15: used until F8 ships citations, which restores
// "Every answer names the article it rests on, so you can check it yourself."
export const AUTH_COVER_STATEMENT =
  'Read, draft, and check Indonesian law in one quiet workspace.';

export function AuthFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="grid min-h-svh w-full flex-1 lg:grid-cols-2"
    >
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <LexonLogo
            variant="wordmark-compact"
            width={128}
            className="dark:hidden"
          />
          <LexonLogo
            variant="wordmark-compact"
            tone="white"
            width={128}
            className="hidden dark:block"
          />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="dark relative hidden bg-(--lexon-night) text-white lg:block"
      >
        <div className="flex h-full flex-col justify-between gap-10 p-12">
          <div className="flex flex-col gap-6">
            <div
              aria-hidden="true"
              className="h-1 w-12 bg-(--lexon-red-text)"
            />
            <p className="text-sm font-medium tracking-wide text-(--lexon-red-text)">
              The AI workspace for Indonesian legal practitioners
            </p>
            <p className="max-w-md font-serif text-4xl leading-tight">
              {AUTH_COVER_STATEMENT}
            </p>
          </div>
          <div className="flex items-end justify-between gap-4">
            <LexonLogo
              variant="wordmark-compact"
              tone="white"
              width={128}
              alt=""
            />
            <span className="text-sm text-muted-foreground">lexon-ai.com</span>
          </div>
        </div>
      </div>
    </main>
  );
}
