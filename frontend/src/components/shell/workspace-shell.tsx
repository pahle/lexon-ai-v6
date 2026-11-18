'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useWorkspace } from './workspace-provider';
import { SessionBoundary } from '../auth/session-boundary';
import { SidebarInset, SidebarTrigger } from '../ui/sidebar';
import {
  ChatFloatingActions,
  isChatChromePath,
  useOpenChat,
} from '../chat/chat-floating-actions';
import { useOptionalSidebar } from './sidebar-context';
import { ChatRuntimeProvider } from './chat-runtime-provider';
import { AuthFrame } from '../auth/auth-frame';
import { SettingsDialog } from '../settings/settings-dialog';
import { usePathname } from 'next/navigation';

const PanelHostContext = createContext<HTMLElement | null>(null);
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
  const hasChatChrome = isChatChromePath(pathname);
  const openChat = useOpenChat();
  const sidebarState = useOptionalSidebar();
  const isMobile = sidebarState?.isMobile ?? false;
  const sidebarCollapsed = sidebarState?.state === 'collapsed';

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
            <a href="/workspace?settings=security">Account security</a>
            <a href="/two-factor?returnTo=%2Fworkspace%3Fsettings%3Dsecurity">
              Verify your sign-in
            </a>
          </nav>
          {!transitioning ? <SettingsDialog /> : null}
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
        <SettingsDialog />
      </>
    );
  const shell = (
    <PanelHostContext.Provider value={panelHost}>
      <>
        <SkipLink />
        {sidebar && sidebarState ? sidebar : null}
        <SidebarInset
          id="main"
          tabIndex={-1}
          className="relative h-dvh max-h-dvh min-h-0 min-w-0 overflow-hidden md:h-[calc(100dvh-1rem)] md:max-h-[calc(100dvh-1rem)]"
        >
          {sidebar && sidebarState ? (
            <header
              data-slot="shell-header"
              className="flex h-14 shrink-0 items-center gap-2 px-2.5 md:h-[52px] md:px-3.5"
            >
              <SidebarTrigger
                className="text-muted-foreground"
                aria-label={
                  isMobile
                    ? 'Open navigation'
                    : sidebarCollapsed
                      ? 'Expand sidebar'
                      : 'Collapse sidebar'
                }
              />
              {openChat ? (
                <>
                  <span
                    aria-hidden="true"
                    data-slot="chat-header-divider"
                    className="h-4 w-px shrink-0 bg-border"
                  />
                  <p
                    data-slot="chat-header-title"
                    aria-hidden="true"
                    className="min-w-0 flex-1 truncate pr-24 text-sm text-foreground"
                  >
                    {openChat.title}
                  </p>
                </>
              ) : null}
            </header>
          ) : null}
          {sidebar && sidebarState && hasChatChrome ? (
            <ChatFloatingActions chat={openChat} />
          ) : null}
          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
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
                    <a
                      className="underline"
                      href="/workspace?settings=security"
                    >
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
        <SettingsDialog />
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
