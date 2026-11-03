import type { ReactElement, ReactNode } from 'react';
import { LexonLogo } from '../lexon-logo';

export function AuthFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="grid min-h-svh w-full flex-1 lg:grid-cols-2"
    >
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <LexonLogo width={160} className="dark:hidden" />
          <LexonLogo width={160} inverse className="hidden dark:block" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </div>
      <div aria-hidden="true" className="relative hidden bg-muted lg:block" />
    </main>
  );
}
