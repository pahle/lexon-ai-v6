'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authClient } from '../../lib/auth-client';
import { fullReload } from '../../lib/full-reload';
import { identityApi } from '../organizations/page-state';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Button } from '../ui/button';
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
  const profile = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: identityApi.profile,
    retry: false,
  });
  const name = profile.data?.name ?? 'Account';
  const email = profile.data?.email ?? '';
  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              disabled={busy}
            />
          }
        >
          <Avatar>
            <AvatarFallback data-slot="avatar-initials" aria-label={name}>
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {email}
            </span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem render={<Link href="/account/security" />}>
            Account security
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailure(false);
              try {
                await query.cancelQueries();
                query.clear();
                const result = await authClient.signOut();
                if (result.error) throw new Error('Sign out failed');
                fullReload('/sign-in', true);
              } catch {
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
