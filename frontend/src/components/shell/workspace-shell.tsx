'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useWorkspace } from './workspace-provider';
import { SessionBoundary } from '../auth/session-boundary';
import { SidebarInset, SidebarTrigger } from '../ui/sidebar';
import { Separator } from '../ui/separator';
import { WorkspaceBreadcrumb } from './workspace-breadcrumb';
import { useOptionalSidebar } from './sidebar-context';
import { ChatRuntimeProvider } from './chat-runtime-provider';
import { AuthFrame } from '../auth/auth-frame';

const PanelHostContext = createContext<HTMLElement | null>(null);
const securityPaths = new Set(['/settings/security']);
function SkipLink() {
  return (
    <a
      className="sr-only inline-flex min-h-11 items-center focus:not-sr-only"
      href="#main"
    >
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
  const {
    identity,
    status,
    transitioning,
    fallbackNotice,
    transitionNotice,
    refreshIdentity,
  } = useWorkspace();
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const pathname = usePathname();
  const sidebarState = useOptionalSidebar();
  const isMobile = sidebarState?.isMobile ?? false;
  const sidebarCollapsed = sidebarState?.state === 'collapsed';
  const securityRoute = securityPaths.has(pathname ?? '');

  if (status === 'expired' || status === 'unavailable')
    return (
      <>
        <SkipLink />
        <main id="main" tabIndex={-1} className="mx-auto max-w-2xl p-6">
          <SessionBoundary embedded state={status} onRetry={refreshIdentity}>
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
            <a href="/settings/security">Account security</a>
            <a href="/two-factor?returnTo=%2Fsettings%2Fsecurity">
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
  if (!identity.user.onboardingCompleted)
    return (
      <>
        <SkipLink />
        <AuthFrame>{children}</AuthFrame>
      </>
    );
  const shell = (
    <PanelHostContext.Provider value={panelHost}>
      <>
        <SkipLink />
        {sidebar && sidebarState ? sidebar : null}
        <SidebarInset id="main" tabIndex={-1} className="min-w-0">
          {sidebar && sidebarState ? (
            <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <SidebarTrigger
                  className="-ml-1"
                  aria-label={
                    isMobile
                      ? 'Open navigation'
                      : sidebarCollapsed
                        ? 'Expand sidebar'
                        : 'Collapse sidebar'
                  }
                />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-vertical:h-4 data-vertical:self-auto"
                />
                <WorkspaceBreadcrumb />
              </div>
            </header>
          ) : null}
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0">
              {sidebar && !sidebarState ? (
                <aside aria-label="Workspace navigation" className="shrink-0">
                  {sidebar}
                </aside>
              ) : null}
              {fallbackNotice ? <p role="status">{fallbackNotice}</p> : null}
              {transitionNotice ? (
                <p role={transitionNotice.securityLink ? 'status' : 'alert'}>
                  {transitionNotice.message}{' '}
                  {transitionNotice.securityLink ? (
                    <a className="underline" href="/settings/security">
                      Account security
                    </a>
                  ) : null}
                </p>
              ) : null}
              {children}
            </div>
            <div
              ref={setPanelHost}
              data-panel-host=""
              className="flex min-h-0"
            />
          </div>
        </SidebarInset>
      </>
    </PanelHostContext.Provider>
  );
  if (identity.user.onboardingCompleted) {
    return (
      <ChatRuntimeProvider
        tenantId={`${identity.user.id}:${identity.organization.id}`}
      >
        {shell}
      </ChatRuntimeProvider>
    );
  }
  return shell;
}

export function usePanelHost(): HTMLElement | null {
  return useContext(PanelHostContext);
}
