'use client';
import type { ReactNode } from 'react';
import { useWorkspace } from '../shell/workspace-provider';
import { PageHeader } from '../shell/page-header';
import { SectionNavigation } from './section-navigation';

export function OrganizationSettingsPageFrame({
  organizationId,
  current,
  children,
}: {
  organizationId: string;
  current: 'members' | 'invitations' | 'general';
  children: ReactNode;
}) {
  const { identity } = useWorkspace();
  const org = identity?.organization;
  const allowed = !!org && org.id === organizationId && org.kind === 'team';
  const items = allowed
    ? [
        {
          href: `/organizations/${organizationId}/settings/members`,
          label: 'Members',
          current: current === 'members',
        },
        ...(org.role !== 'member'
          ? [
              {
                href: `/organizations/${organizationId}/settings/invitations`,
                label: 'Invitations',
                current: current === 'invitations',
              },
            ]
          : []),
        ...(org.role === 'owner'
          ? [
              {
                href: `/organizations/${organizationId}/settings/general`,
                label: 'General',
                current: current === 'general',
              },
            ]
          : []),
      ]
    : [];
  return (
    <div className="mx-auto flex max-w-2xl min-w-0 flex-col gap-6">
      <PageHeader title="Organization settings" />
      {items.length ? <SectionNavigation items={items} /> : null}
      {children}
    </div>
  );
}
