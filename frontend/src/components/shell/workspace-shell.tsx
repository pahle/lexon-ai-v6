'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useWorkspace } from './workspace-provider';
import { SessionBoundary } from '../auth/session-boundary';

const PanelHostContext = createContext<HTMLElement | null>(null);
const securityPaths = new Set(['/account/security', '/settings/security']);
function SkipLink() {
  return (
    <a className="sr-only focus:not-sr-only" href="#main">
      Skip to content
    </a>
  );
}

export function WorkspaceShell({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
}) {
  const { identity, status, transitioning, fallbackNotice } = useWorkspace();
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const pathname = usePathname();
  const securityRoute = securityPaths.has(pathname ?? '');

  if (status === 'expired' || status === 'unavailable')
    return (
      <>
        <SkipLink />
        <main id="main" tabIndex={-1} className="mx-auto max-w-2xl p-6">
          <SessionBoundary embedded state={status}>
            {null}
          </SessionBoundary>
        </main>
      </>
    );
  if (status === 'mfa-required')
    return (
      <>
        <SkipLink />
        <main id="main" tabIndex={-1} className="mx-auto max-w-2xl p-6">
          <nav className="flex flex-wrap gap-4" aria-label="Account recovery">
            <a href="/account/security">Account security</a>
            <a href="/two-factor?returnTo=%2Faccount%2Fsecurity">
              Verify your sign-in
            </a>
          </nav>
          {securityRoute && !transitioning ? children : null}
        </main>
      </>
    );
  if (status !== 'ready' || transitioning || !identity)
    return (
      <>
        <SkipLink />
        <main id="main" tabIndex={-1} aria-busy="true" role="status">
          Verifying your workspace…
        </main>
      </>
    );
  return (
    <PanelHostContext.Provider value={panelHost}>
      <>
        <SkipLink />
        <div className="mx-auto flex min-w-0 max-w-7xl flex-col gap-6 p-6 md:flex-row">
          {identity.user.onboardingCompleted && sidebar ? (
            <aside aria-label="Workspace navigation" className="shrink-0">
              {sidebar}
            </aside>
          ) : null}
          <main id="main" tabIndex={-1} className="min-w-0 flex-1">
            {fallbackNotice ? <p role="status">{fallbackNotice}</p> : null}
            {children}
          </main>
          <div ref={setPanelHost} data-panel-host="" />
        </div>
      </>
    </PanelHostContext.Provider>
  );
}

export function usePanelHost(): HTMLElement | null {
  return useContext(PanelHostContext);
}
