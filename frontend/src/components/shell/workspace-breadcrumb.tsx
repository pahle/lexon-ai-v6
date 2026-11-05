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

function routeCrumbs(pathname: string): Crumb[] {
  if (pathname === '/workspace') return [{ title: 'Home' }];
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
  const crumbs = routeCrumbs(pathname);

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
            {index > 0 ? (
              <BreadcrumbSeparator className="hidden md:block" />
            ) : null}
            <BreadcrumbItem
              className={index < crumbs.length - 1 ? 'hidden md:block' : ''}
            >
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
