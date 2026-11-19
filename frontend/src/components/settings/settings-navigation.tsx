'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useWorkspace } from '../shell/workspace-provider';
import { settingsHref, type SettingsSection } from './settings-url';

const accountSections: { id: SettingsSection; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'security', label: 'Security' },
];

export function SettingsNavigation({
  section,
  recoveryOnly = false,
  onSelect,
}: {
  section: SettingsSection | 'invalid' | null;
  recoveryOnly?: boolean;
  onSelect?: () => void;
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
    onSelect?.();
    router.replace(settingsHref(window.location.href, id), { scroll: false });
  };

  return (
    <nav
      aria-label="Settings sections"
      className="flex h-full min-w-0 flex-col gap-0.5 bg-sidebar p-3 max-md:h-auto"
    >
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
    <>
      <div
        data-slot="settings-group-label"
        className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground"
      >
        {title}
      </div>
      {items.map(({ id, label }) => (
        <Link
          key={id}
          data-slot="settings-nav-link"
          href={settingsHref(
            typeof window === 'undefined'
              ? pathname + '?settings=' + id
              : window.location.href,
            id,
          )}
          aria-current={section === id ? 'page' : undefined}
          onClick={(event) => onNavigate(event, id)}
          className="flex h-8 w-full items-center truncate rounded-md px-2 text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium"
        >
          {label}
        </Link>
      ))}
    </>
  );
}
