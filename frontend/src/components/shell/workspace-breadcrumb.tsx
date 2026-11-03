'use client';

import { Fragment } from 'react';
import { usePathname } from 'next/navigation';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../ui/breadcrumb';
import { useWorkspace } from './workspace-provider';

type Crumb = { title: string; href?: string };

function routeCrumbs(pathname: string, organizationId?: string): Crumb[] {
  if (pathname === '/workspace') return [{ title: 'Home' }];
  if (pathname === '/settings/profile')
    return [
      { title: 'Settings', href: '/settings/profile' },
      { title: 'Profile' },
    ];
  if (pathname === '/settings/security')
    return [
      { title: 'Settings', href: '/settings/profile' },
      { title: 'Security' },
    ];
  if (pathname === '/settings/appearance')
    return [
      { title: 'Settings', href: '/settings/profile' },
      { title: 'Appearance' },
    ];
  const organizationSettings = pathname.match(
    /^\/organizations\/([^/]+)\/settings\/(members|invitations|general)$/,
  );
  if (organizationSettings) {
    const routeOrganizationId = organizationSettings[1];
    const section = organizationSettings[2];
    const labels: Record<string, string> = {
      members: 'Members',
      invitations: 'Invitations',
      general: 'General',
    };
    const label = labels[section ?? ''];
    if (label)
      return [
        {
          title: 'Organization settings',
          href: `/organizations/${organizationId ?? routeOrganizationId}/settings/members`,
        },
        { title: label },
      ];
  }
  if (pathname === '/platform/provisioning')
    return [
      { title: 'Platform', href: '/platform/provisioning' },
      { title: 'Provisioning' },
    ];
  if (/^\/platform\/provisioning\/[^/]+$/.test(pathname))
    return [
      { title: 'Platform', href: '/platform/provisioning' },
      { title: 'Provisioning', href: '/platform/provisioning' },
      { title: 'Provisioning details' },
    ];
  if (pathname === '/platform/accounts')
    return [
      { title: 'Platform', href: '/platform/provisioning' },
      { title: 'Account status' },
    ];
  return [{ title: 'Home', href: '/workspace' }, { title: 'Page not found' }];
}

export function WorkspaceBreadcrumb() {
  const pathname = usePathname() ?? '';
  const { identity } = useWorkspace();
  const crumbs = routeCrumbs(pathname, identity?.organization.id);

  // Org pages are gated by the same ready identity as the shell. Keep labels
  // generic so the breadcrumb never reveals a hidden personal organization.
  if (
    pathname.startsWith('/organizations/') &&
    identity?.organization.kind !== 'team'
  ) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.title}-${index}`}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {crumb.href ? (
                <BreadcrumbLink href={crumb.href}>{crumb.title}</BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
