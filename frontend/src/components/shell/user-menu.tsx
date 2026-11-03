'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '../../lib/auth-client';
import { fullReload } from '../../lib/full-reload';
import { useWorkspace } from './workspace-provider';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Button } from '../ui/button';
import { useOptionalSidebar } from './sidebar-context';
import { requestRouteHeadingFocus } from './navigation-focus';
import { ChevronsUpDown, LogOut, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../ui/sidebar';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu({
  onMobileNavigate,
}: {
  onMobileNavigate?: () => void;
} = {}) {
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const mobileNavigationPending = useRef(false);
  const {
    identity,
    beginExplicitTransition,
    finishExplicitTransition,
    refreshIdentity,
  } = useWorkspace();
  const sidebar = useOptionalSidebar();
  const pathname = usePathname() ?? '';
  const collapsed = sidebar?.state === 'collapsed' && !sidebar.isMobile;
  const name = identity?.user.name ?? 'Account';
  const email = identity?.user.email ?? '';
  const requestSettingsNavigation = () => {
    if (sidebar?.isMobile) {
      if (!mobileNavigationPending.current) {
        mobileNavigationPending.current = true;
        onMobileNavigate?.();
      }
    } else requestRouteHeadingFocus();
  };
  const menu = (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        render={
          sidebar ? (
            <SidebarMenuButton
              size="lg"
              title={collapsed ? name : undefined}
              className="aria-expanded:bg-muted"
              disabled={busy}
            />
          ) : (
            <Button
              variant="ghost"
              title={collapsed ? name : undefined}
              className="w-full justify-start gap-2"
              disabled={busy}
            />
          )
        }
      >
        <Avatar>
          <AvatarFallback data-slot="avatar-initials" aria-label={name}>
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        {!collapsed ? (
          <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {email}
            </span>
          </span>
        ) : null}
        {!collapsed ? (
          <ChevronsUpDown aria-hidden="true" className="ml-auto size-4" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side={sidebar?.isMobile ? 'bottom' : 'right'}
        sideOffset={4}
        className="w-fit"
        finalFocus={() => {
          if (mobileNavigationPending.current) {
            mobileNavigationPending.current = false;
            return false;
          }
          return true;
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex min-w-0 items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar>
                <AvatarFallback data-slot="avatar-initials" aria-label={name}>
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {email}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            render={
              <Link
                href="/settings/profile"
                onNavigate={() => {
                  if (pathname !== '/settings/profile')
                    requestSettingsNavigation();
                }}
              />
            }
            onClick={() => {
              if (pathname !== '/settings/profile') requestSettingsNavigation();
              setMenuOpen(false);
              if (sidebar?.isMobile) sidebar.setOpenMobile(false);
            }}
          >
            <Settings aria-hidden="true" />
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
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const content = (
    <>
      {sidebar ? (
        <SidebarMenu>
          <SidebarMenuItem>{menu}</SidebarMenuItem>
        </SidebarMenu>
      ) : (
        menu
      )}
      {failure ? (
        <p role="alert" className="px-2 text-sm">
          Unable to sign out. Please try again.
        </p>
      ) : null}
    </>
  );
  return content;
}
