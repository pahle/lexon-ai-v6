'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { ChevronRight, Home, Shield, X } from 'lucide-react';
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
import { OrganizationMenu } from './organization-menu';
import { UserMenu } from './user-menu';
import { Button } from '../ui/button';
import { ThreadList } from '../assistant-ui/elements/thread-list.aui';
import { requestRouteHeadingFocus } from './navigation-focus';

type Destination = { title: string; href: string };

function NavigationGroup({
  title,
  icon: Icon,
  active,
  destinations,
  onNavigate,
}: {
  title: string;
  icon: typeof Shield;
  active: boolean;
  destinations: Destination[];
  onNavigate: () => void;
}) {
  const pathname = usePathname() ?? '';
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Collapsible
      defaultOpen={active}
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
            className="size-6 peer-data-[size=default]/menu-button:top-1"
          />
        }
      >
        <ChevronRight
          aria-hidden="true"
          className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {destinations.map(({ title: label, href }) => {
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
                  {label}
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
  const { isMobile, setOpenMobile, state } = useSidebar();
  const mobileNavigation = useRef<{
    from: string;
    pathnameChanged: boolean;
    sheetClosed: boolean;
  } | null>(null);
  const pathname = usePathname() ?? '';
  const finishMobileNavigation = useCallback(() => {
    const pending = mobileNavigation.current;
    if (!pending?.pathnameChanged || !pending.sheetClosed) return;
    mobileNavigation.current = null;
    document.querySelector<HTMLElement>('#main h1[tabindex="-1"]')?.focus();
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
      };
    }
  };
  if (!identity) return null;

  return (
    <Sidebar
      collapsible="icon"
      role={isMobile ? undefined : 'complementary'}
      aria-label={isMobile ? undefined : 'Workspace navigation'}
      mobileFinalFocus={() => (mobileNavigation.current ? false : true)}
      onMobileOpenChangeComplete={(open) => {
        const pending = mobileNavigation.current;
        if (open || !pending) return;
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
        <nav aria-label="Primary navigation">
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === '/workspace'}
                  tooltip="Home"
                  aria-current={pathname === '/workspace' ? 'page' : undefined}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                  render={
                    <Link
                      href="/workspace"
                      onNavigate={() => {
                        if (pathname !== '/workspace') requestNavigationFocus();
                      }}
                    />
                  }
                >
                  <Home aria-hidden="true" />
                  <span>Home</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
          <SidebarGroup role="group" aria-label="Conversations">
            <SidebarGroupLabel>Conversations</SidebarGroupLabel>
            <ThreadList />
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu onMobileNavigate={requestNavigationFocus} />
      </SidebarFooter>
    </Sidebar>
  );
}
