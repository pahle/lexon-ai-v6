'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Settings, Building2, Shield } from 'lucide-react';
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
  SidebarMenuItem,
  useSidebar,
} from '../ui/sidebar';
import { OrganizationMenu } from './organization-menu';
import { UserMenu } from './user-menu';
import { ThreadList } from '../assistant-ui/elements/thread-list.aui';
import { requestRouteHeadingFocus } from './navigation-focus';

export function AppSidebar() {
  const { identity } = useWorkspace();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const pathname = usePathname() ?? '';
  if (!identity) return null;
  const items = [
    {
      label: 'Home',
      href: '/workspace',
      icon: Home,
      active: pathname === '/workspace',
    },
    {
      label: 'Settings',
      href: '/settings/profile',
      icon: Settings,
      active: pathname.startsWith('/settings/'),
    },
    ...(identity.organization.kind === 'team'
      ? [
          {
            label: 'Organization settings',
            href: `/organizations/${identity.organization.id}/settings/members`,
            icon: Building2,
            active: pathname.startsWith(
              `/organizations/${identity.organization.id}/settings/`,
            ),
          },
        ]
      : []),
    ...(identity.platformAdmin
      ? [
          {
            label: 'Platform',
            href: '/platform/provisioning',
            icon: Shield,
            active: pathname.startsWith('/platform/'),
          },
        ]
      : []),
  ];
  return (
    <Sidebar
      collapsible="icon"
      className="min-h-[calc(100svh-3rem)] border border-border bg-background"
    >
      <SidebarHeader className="p-2">
        <div className="flex min-h-11 items-center px-2 text-sm font-semibold">
          <span
            className="truncate group-data-[collapsible=icon]:sr-only"
            title={state === 'collapsed' ? 'Lexon' : undefined}
          >
            Lexon
          </span>
        </div>
        <OrganizationMenu identity={identity} />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Primary navigation">
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              {items.map(({ label, href, icon: Icon, active }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    className="min-h-11 min-w-11"
                    isActive={active}
                    tooltip={label}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      if (pathname !== href) requestRouteHeadingFocus();
                      if (isMobile) setOpenMobile(false);
                    }}
                    render={<Link href={href} />}
                  >
                    <Icon aria-hidden="true" />
                    <span className="group-data-[collapsible=icon]:sr-only">
                      {label}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
        {state === 'expanded' || isMobile ? (
          <SidebarGroup>
            <SidebarGroupLabel>Conversations</SidebarGroupLabel>
            <ThreadList />
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="p-2">
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
