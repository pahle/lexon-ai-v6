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

function routeCrumbs(pathname: string, chatTitle = 'Chat'): Crumb[] {
  if (pathname === '/workspace') return [{ title: 'New chat' }];
  if (pathname === '/chats') return [{ title: 'Chats' }];
  if (/^\/chats\/[0-9a-f-]{36}$/i.test(pathname))
    return [{ title: 'Chats', href: '/chats' }, { title: chatTitle }];
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
  return [
    { title: 'New chat', href: '/workspace' },
    { title: 'Page not found' },
  ];
}

export function WorkspaceBreadcrumb() {
  const pathname = usePathname() ?? '';
  const { identity, chatTitle } = useWorkspace();
  const threadMatch = /^\/chats\/([0-9a-f-]{36})$/i.exec(pathname);
  const actorScope = identity
    ? `${identity.organization.id}:${identity.user.id}`
    : '';
  const title =
    threadMatch &&
    chatTitle &&
    chatTitle.chatId === threadMatch[1] &&
    chatTitle.actorScope === actorScope
      ? chatTitle.title
      : 'Chat';
  const crumbs = routeCrumbs(pathname, title);

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
