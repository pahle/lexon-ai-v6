'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Ellipsis, MessageCircle, Shield, X } from 'lucide-react';
import { useWorkspace } from './workspace-provider';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '../ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { OrganizationMenu } from './organization-menu';
import { UserMenu } from './user-menu';
import { Button } from '../ui/button';
import { RecentChats } from '../chat/chat-history';
import { createChatClient } from '../../lib/chat-client';
import { requestRouteHeadingFocus } from './navigation-focus';
import { shouldOpenNewChatShortcut } from '../../lib/chat-navigation';

type Destination = { title: string; href: string; shortcutHint?: boolean };

/**
 * The visible hint for the New chat shortcut (Ctrl/Cmd + Alt + N). It is
 * decoration: the link's accessible name stays "New chat". The Apple form is
 * chosen after mount, so server and client markup agree.
 */
function NewChatShortcutHint() {
  const [apple, setApple] = useState(false);
  useEffect(() => {
    setApple(/^(Mac|iPhone|iPad|iPod)/.test(window.navigator.platform));
  }, []);
  return (
    <span
      data-slot="shortcut-hint"
      aria-hidden="true"
      className="ml-auto text-xs text-muted-foreground"
    >
      {apple ? '⌘ ⌥ N' : 'Ctrl Alt N'}
    </span>
  );
}

function NavigationGroup({
  title,
  icon: Icon,
  active,
  defaultOpen = active,
  collapsedMenu = false,
  destinations,
  onNavigate,
}: {
  title: string;
  icon: typeof Shield;
  active: boolean;
  /** Open on first render. Defaults to open only while a destination is active. */
  defaultOpen?: boolean;
  /**
   * In the collapsed (icon) sidebar the sub-items are hidden. With this set,
   * the icon opens a menu with the same destinations, so they stay reachable
   * by keyboard without expanding the sidebar.
   */
  collapsedMenu?: boolean;
  destinations: Destination[];
  onNavigate: () => void;
}) {
  const pathname = usePathname() ?? '';
  const { isMobile, setOpenMobile, state } = useSidebar();
  if (collapsedMenu && !isMobile && state === 'collapsed')
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                tooltip={title}
                isActive={active}
                aria-label={`${title} navigation`}
              />
            }
          >
            <Icon aria-hidden="true" />
            <span>{title}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="min-w-40">
            {destinations.map(({ title: label, href }) => (
              <DropdownMenuItem
                key={href}
                aria-current={pathname === href ? 'page' : undefined}
                render={
                  <Link
                    href={href}
                    onNavigate={() => {
                      if (pathname !== href) onNavigate();
                    }}
                  />
                }
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <SidebarMenuButton
        tooltip={title}
        isActive={active}
        onClick={() => {
          if (isMobile) setOpenMobile(false);
        }}
        render={
          <Link
            href={destinations[0]?.href ?? '/workspace'}
            onNavigate={() => {
              const href = destinations[0]?.href;
              if (href && pathname !== href) onNavigate();
            }}
          />
        }
      >
        <Icon aria-hidden="true" />
        <span>{title}</span>
      </SidebarMenuButton>
      <CollapsibleTrigger
        render={
          <SidebarMenuAction
            aria-label={`Toggle ${title} navigation`}
            className="top-1 right-0 size-6 p-0"
          />
        }
      >
        <ChevronRight
          aria-hidden="true"
          className="translate-x-1 transition-transform duration-200 group-data-open/collapsible:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {destinations.map(({ title: label, href, shortcutHint }) => {
            const current = pathname === href;
            return (
              <SidebarMenuSubItem key={href}>
                <SidebarMenuSubButton
                  isActive={current}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                  render={
                    <Link
                      href={href}
                      onNavigate={() => {
                        if (pathname !== href) onNavigate();
                      }}
                    />
                  }
                >
                  <span>{label}</span>
                  {shortcutHint ? <NewChatShortcutHint /> : null}
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { identity } = useWorkspace();
  const router = useRouter();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const mobileNavigation = useRef<{
    from: string;
    pathnameChanged: boolean;
    sheetClosed: boolean;
    headingFocused: boolean;
  } | null>(null);
  const pathname = usePathname() ?? '';
  const chatClient = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const chatScope = identity
    ? { orgId: identity.organization.id, userId: identity.user.id }
    : null;
  const currentChatId = /^\/chats\/([0-9a-f-]{36})$/i.exec(pathname)?.[1];
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldOpenNewChatShortcut(event)) return;
      event.preventDefault();
      router.push('/workspace');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);
  const finishMobileNavigation = useCallback(() => {
    const pending = mobileNavigation.current;
    if (!pending?.pathnameChanged || !pending.sheetClosed) return;
    if (pending.headingFocused) return;
    const heading = document.querySelector<HTMLElement>(
      '#main h1[tabindex="-1"]',
    );
    if (!heading) return;
    heading.focus();
    pending.headingFocused = true;
  }, []);
  useEffect(() => {
    const pending = mobileNavigation.current;
    if (pending && pathname !== pending.from) {
      pending.pathnameChanged = true;
      finishMobileNavigation();
    }
  }, [finishMobileNavigation, pathname]);
  const requestNavigationFocus = () => {
    requestRouteHeadingFocus();
    if (isMobile && !mobileNavigation.current) {
      mobileNavigation.current = {
        from: pathname,
        pathnameChanged: false,
        sheetClosed: false,
        headingFocused: false,
      };
    }
  };
  if (!identity) return null;

  const viewAllChats = (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
          render={
            <Link
              href="/chats"
              onNavigate={() => {
                if (pathname !== '/chats') requestNavigationFocus();
              }}
            />
          }
        >
          <Ellipsis aria-hidden="true" />
          <span>View all chats</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
  return (
    <Sidebar
      variant="inset"
      collapsible="icon"
      role={isMobile ? undefined : 'complementary'}
      aria-label={isMobile ? undefined : 'Workspace navigation'}
      mobileFinalFocus={() => (mobileNavigation.current ? false : true)}
      onMobileOpenChangeComplete={(open) => {
        if (open) {
          // Keep suppressing opener restoration until the next sheet lifecycle starts.
          mobileNavigation.current = null;
          return;
        }
        const pending = mobileNavigation.current;
        if (!pending) return;
        pending.sheetClosed = true;
        finishMobileNavigation();
      }}
    >
      <SidebarHeader>
        <OrganizationMenu identity={identity} />
        {isMobile ? (
          <div className="flex justify-end px-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close navigation"
              onClick={() => setOpenMobile(false)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Primary navigation" className="flex flex-col">
          <SidebarGroup>
            <div
              aria-hidden="true"
              data-slot="sidebar-group-spacer"
              className="h-2"
            />
            <SidebarMenu>
              <NavigationGroup
                title="Assistant"
                icon={MessageCircle}
                active={
                  pathname === '/workspace' || pathname.startsWith('/chats')
                }
                defaultOpen
                collapsedMenu
                onNavigate={requestNavigationFocus}
                destinations={[
                  { title: 'New chat', href: '/workspace', shortcutHint: true },
                  { title: 'Chats', href: '/chats' },
                ]}
              />
              {identity.platformAdmin ? (
                <NavigationGroup
                  title="Platform"
                  icon={Shield}
                  active={pathname.startsWith('/platform/')}
                  onNavigate={requestNavigationFocus}
                  destinations={[
                    { title: 'Provisioning', href: '/platform/provisioning' },
                    { title: 'Account status', href: '/platform/accounts' },
                  ]}
                />
              ) : null}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
        {state === 'expanded' || isMobile ? (
          <SidebarGroup role="group" aria-label="Recent chats">
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            {chatScope ? (
              <RecentChats
                client={chatClient}
                scope={chatScope}
                onNavigate={requestNavigationFocus}
                onCloseMobile={() => {
                  if (isMobile) setOpenMobile(false);
                }}
                {...(currentChatId ? { currentChatId } : {})}
                viewAll={viewAllChats}
              />
            ) : null}
            {chatScope ? null : viewAllChats}
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu onMobileNavigate={requestNavigationFocus} />
      </SidebarFooter>
    </Sidebar>
  );
}
