'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useWorkspace } from './workspace-provider';
import { SessionBoundary } from '../auth/session-boundary';
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
  const securityRoute = pathname === '/account/security';
  if (status === 'expired' || status === 'unavailable')
    return <SessionBoundary state={status}>{null}</SessionBoundary>;
  if (status === 'mfa-required')
    return (
      <main id="main" className="mx-auto max-w-2xl p-6">
        <a href="/account/security">Account security</a>
        {securityRoute ? children : null}
      </main>
    );
  if (status !== 'ready' || transitioning || !identity)
    return (
      <main id="main" aria-busy="true" role="status">
        Verifying your workspace…
      </main>
    );
  return (
    <PanelHostContext.Provider value={panelHost}>
      <>
        <a className="sr-only focus:not-sr-only" href="#main">
          Skip to content
        </a>
        {identity.user.onboardingCompleted && sidebar ? (
          <aside>{sidebar}</aside>
        ) : null}
        <main id="main" className="mx-auto max-w-6xl p-6">
          {fallbackNotice ? <p role="status">{fallbackNotice}</p> : null}
          {children}
          <div ref={setPanelHost} data-panel-host="" />
        </main>
      </>
    </PanelHostContext.Provider>
  );
}
const PanelHostContext = createContext<HTMLElement | null>(null);
export function usePanelHost(): HTMLElement | null {
  return useContext(PanelHostContext);
}
