'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useWorkspace } from '../shell/workspace-provider';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '../ui/sidebar';
import { settingsHref, type SettingsSection } from './settings-url';

const accountSections: { id: SettingsSection; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'security', label: 'Security' },
];

export function SettingsNavigation({
  section,
  recoveryOnly = false,
}: {
  section: SettingsSection | 'invalid' | null;
  recoveryOnly?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/workspace';
  const { identity } = useWorkspace();
  const team = !recoveryOnly && identity?.organization.kind === 'team';
  const accountItems = recoveryOnly
    ? [{ id: 'security' as const, label: 'Security' }]
    : accountSections;
  const organizationSections: { id: SettingsSection; label: string }[] = team
    ? [
        { id: 'members', label: 'Members' },
        ...(identity.organization.role === 'owner' ||
        identity.organization.role === 'admin'
          ? [{ id: 'invitations' as const, label: 'Invitations' }]
          : []),
        ...(identity.organization.role === 'owner'
          ? [{ id: 'general' as const, label: 'General' }]
          : []),
      ]
    : [];
  const navigate = (
    event: React.MouseEvent<HTMLAnchorElement>,
    id: SettingsSection,
  ) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    router.replace(settingsHref(window.location.href, id), { scroll: false });
  };

  return (
    <nav
      aria-label="Settings sections"
      className="h-full min-w-0 max-[767px]:h-auto"
    >
      <SidebarProvider
        defaultOpen
        style={{ '--sidebar-width': '15rem' } as React.CSSProperties}
        className="h-full min-h-0 min-w-0 flex-1 items-start max-[767px]:h-auto"
      >
        <Sidebar
          collapsible="none"
          className="h-full max-[767px]:h-auto max-[767px]:w-full max-[767px]:border-b"
        >
          <SidebarContent className="max-[767px]:overflow-visible">
            <SettingsGroup
              title="Account"
              items={accountItems}
              section={section}
              pathname={pathname}
              onNavigate={navigate}
            />
            {team ? (
              <SettingsGroup
                title={identity.organization.name}
                items={organizationSections}
                section={section}
                pathname={pathname}
                onNavigate={navigate}
              />
            ) : null}
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </nav>
  );
}

function SettingsGroup({
  title,
  items,
  section,
  pathname,
  onNavigate,
}: {
  title: string;
  items: { id: SettingsSection; label: string }[];
  section: SettingsSection | 'invalid' | null;
  pathname: string;
  onNavigate: (
    event: React.MouseEvent<HTMLAnchorElement>,
    id: SettingsSection,
  ) => void;
}) {
  return (
    <SidebarGroup className="py-2">
      <SidebarGroupLabel className="text-sidebar-foreground">
        {title}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ id, label }) => (
            <SidebarMenuItem key={id}>
              <SidebarMenuButton
                render={
                  <Link
                    href={settingsHref(
                      typeof window === 'undefined'
                        ? pathname + '?settings=' + id
                        : window.location.href,
                      id,
                    )}
                    aria-current={section === id ? 'page' : undefined}
                    onClick={(event) => onNavigate(event, id)}
                  />
                }
                isActive={section === id}
              >
                {label}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
