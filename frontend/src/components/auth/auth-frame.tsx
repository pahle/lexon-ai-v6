import type { ReactElement, ReactNode } from 'react';
import { LexonLogo } from '../lexon-logo';

// Owner decision 2026-11-15: used until F8 ships citations, which restores
// "Every answer names the article it rests on, so you can check it yourself."
export const AUTH_COVER_STATEMENT =
  'Read, draft, and check Indonesian law in one quiet workspace.';

// LEX-DS-001 v3.1 §5.5 "Auth pages": two equal columns from 768px. The form
// column carries the only wordmark; the Night cover has the rule, tagline,
// statement, and domain. Below 768px: one column on `background`.
export function AuthFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-svh w-full flex-1 flex-col bg-background md:grid md:grid-cols-2"
    >
      <div
        data-slot="auth-form-column"
        className="flex flex-1 flex-col items-center justify-between gap-6 px-5 py-7 md:items-stretch md:justify-start md:bg-sidebar md:p-10"
      >
        <div className="flex justify-center md:justify-start">
          <LexonLogo
            variant="wordmark-compact"
            width={96}
            className="max-md:h-auto max-md:w-[88px] dark:hidden"
          />
          <LexonLogo
            variant="wordmark-compact"
            tone="white"
            width={96}
            className="hidden max-md:h-auto max-md:w-[88px] dark:block"
          />
        </div>
        <div className="flex w-full justify-center md:flex-1 md:items-center">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
        <div aria-hidden="true" className="h-9 flex-none md:h-11" />
      </div>
      <div
        aria-hidden="true"
        className="dark hidden flex-col justify-between bg-(--lexon-night) p-12 text-foreground md:flex"
      >
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="h-0.5 w-10 shrink-0 bg-(--lexon-red-text)"
          />
          <p className="text-[13px] font-medium text-(--lexon-red-text)">
            The AI workspace for Indonesian legal practitioners
          </p>
        </div>
        <p className="max-w-[520px] font-serif text-[44px] leading-[1.15] font-normal tracking-[-0.01em]">
          {AUTH_COVER_STATEMENT}
        </p>
        <div className="flex justify-end">
          <span className="text-[13px] text-muted-foreground">
            lexon-ai.com
          </span>
        </div>
      </div>
    </main>
  );
}
