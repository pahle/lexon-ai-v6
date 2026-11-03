'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '../../lib/auth-client';
import { fullReload } from '../../lib/full-reload';
import { useWorkspace } from './workspace-provider';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Button } from '../ui/button';
import { useOptionalSidebar } from './sidebar-context';
import { requestRouteHeadingFocus } from './navigation-focus';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu() {
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const {
    identity,
    beginExplicitTransition,
    finishExplicitTransition,
    refreshIdentity,
  } = useWorkspace();
  const sidebar = useOptionalSidebar();
  const pathname = usePathname() ?? '';
  const collapsed = sidebar?.state === 'collapsed';
  const name = identity?.user.name ?? 'Account';
  const email = identity?.user.email ?? '';
  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              title={collapsed ? name : undefined}
              className={
                collapsed
                  ? 'w-11 min-h-11 min-w-11 justify-center px-0'
                  : 'w-full min-h-11 justify-start gap-2'
              }
              disabled={busy}
            />
          }
        >
          <Avatar>
            <AvatarFallback data-slot="avatar-initials" aria-label={name}>
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          {!collapsed ? (
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {email}
              </span>
            </span>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            render={<Link href="/settings/profile" />}
            onClick={() => {
              if (pathname !== '/settings/profile') requestRouteHeadingFocus();
              if (sidebar?.isMobile) sidebar.setOpenMobile(false);
            }}
          >
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailure(false);
              beginExplicitTransition({ requireFreshIdentity: true });
              try {
                await query.cancelQueries();
                query.clear();
                const result = await authClient.signOut();
                if (result.error) throw new Error('Sign out failed');
                fullReload('/sign-in', true);
              } catch {
                try {
                  await refreshIdentity();
                } catch {
                  // Keep protected content hidden until the unavailable retry verifies identity.
                }
                finishExplicitTransition({
                  message: 'Unable to sign out. Please try again.',
                });
                setFailure(true);
                setBusy(false);
              }
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failure ? (
        <p role="alert" className="px-2 text-sm">
          Unable to sign out. Please try again.
        </p>
      ) : null}
    </div>
  );
}
