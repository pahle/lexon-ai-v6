'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import type { IdentitySummary, OrganizationSummary } from '@lexon/contracts';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { transitionTenant } from '../../lib/tenant-queries';
import { fullReload } from '../../lib/full-reload';
import { initials } from '../../lib/initials';
import { LexonLogo } from '../lexon-logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../ui/sidebar';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { CreateTeam } from '../organizations/create-team';
import {
  identityApi,
  identityMessage,
  useCursorPage,
} from '../organizations/page-state';
import { useOptionalSidebar } from './sidebar-context';
import { useWorkspace } from './workspace-provider';

function orgLabel(org: OrganizationSummary) {
  return org.kind === 'personal' ? 'Personal' : org.name;
}

function organizationRole(org: OrganizationSummary) {
  return org.role.charAt(0).toUpperCase() + org.role.slice(1);
}

function memberCountLabel(count: number) {
  return count === 1 ? '1 member' : `${count} members`;
}

function OrganizationTile({
  organization,
  size,
}: {
  organization: OrganizationSummary;
  size: 'trigger' | 'item';
}) {
  const box =
    size === 'trigger' ? 'size-8 rounded-[8px]' : 'size-6 rounded-[6px]';
  if (organization.kind === 'personal') {
    return (
      <span
        aria-hidden="true"
        className={`flex ${box} shrink-0 items-center justify-center bg-background shadow-[0_0_0_1px_var(--border)]`}
      >
        <LexonLogo variant="monogram" width={size === 'trigger' ? 20 : 15} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      // Initials are generated content so they stay out of the visible-text
      // check of WCAG 2.5.3; the tile is decorative.
      data-initials={initials(organization.name)}
      className={`flex ${box} shrink-0 items-center justify-center before:content-[attr(data-initials)] bg-sidebar-primary text-sidebar-primary-foreground ${size === 'trigger' ? 'text-xs' : 'text-[10px]'} font-semibold`}
    />
  );
}

function triggerDetail({
  organization,
  organizationMemberCount,
}: IdentitySummary) {
  if (organization.kind === 'personal') return 'Your private workspace';
  return organizationMemberCount === null
    ? null
    : memberCountLabel(organizationMemberCount);
}

// WCAG 2.5.3: the accessible name contains the visible name and detail text in
// the order shown; the role follows because it is not visible.
function triggerLabel(identity: IdentitySummary) {
  const detail = triggerDetail(identity);
  const visible = [orgLabel(identity.organization), detail]
    .filter(Boolean)
    .join(' ');
  return `Organization: ${visible}, ${organizationRole(identity.organization)}`;
}

function TriggerText({ identity }: { identity: IdentitySummary }) {
  const { organization } = identity;
  const detail = triggerDetail(identity);
  return (
    <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
      <span className="truncate font-medium">{orgLabel(organization)}</span>
      {detail ? (
        <>
          {' '}
          <span className="truncate text-xs text-muted-foreground">
            {detail}
          </span>
        </>
      ) : null}
    </span>
  );
}

export function OrganizationMenu({ identity }: { identity: IdentitySummary }) {
  const query = useQueryClient();
  const { beginExplicitTransition, finishExplicitTransition, refreshIdentity } =
    useWorkspace();
  const organizationTrigger = useRef<HTMLButtonElement>(null);
  const sidebar = useOptionalSidebar();
  const collapsed = sidebar?.state === 'collapsed' && !sidebar.isMobile;
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const pages = useCursorPage(
    ['organizations'],
    (cursor) =>
      identityApi.listOrganizations({
        limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
    true,
  );
  // The API orders by membership id; the menu lists Personal first, then teams by name.
  const organizations = [
    ...(pages.query.data?.items ?? [identity.organization]),
  ].sort(
    (a, b) =>
      Number(b.kind === 'personal') - Number(a.kind === 'personal') ||
      a.name.localeCompare(b.name),
  );
  const restoreFocus = () => {
    window.setTimeout(() => organizationTrigger.current?.focus(), 0);
  };
  return (
    <Dialog
      open={createOpen}
      onOpenChange={(nextOpen) => {
        setCreateOpen(nextOpen);
        if (nextOpen) setOpen(false);
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) restoreFocus();
      }}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        {sidebar ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenuTrigger
                ref={organizationTrigger}
                aria-label={triggerLabel(identity)}
                title={collapsed ? orgLabel(identity.organization) : undefined}
                render={
                  <SidebarMenuButton
                    size="lg"
                    tooltip={orgLabel(identity.organization)}
                  />
                }
              >
                <OrganizationTile
                  organization={identity.organization}
                  size="trigger"
                />
                {!collapsed ? <TriggerText identity={identity} /> : null}
                {!collapsed ? (
                  <ChevronsUpDown
                    aria-hidden="true"
                    className="ml-auto size-4 text-muted-foreground"
                  />
                ) : null}
              </DropdownMenuTrigger>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <DropdownMenuTrigger
            ref={organizationTrigger}
            aria-label={triggerLabel(identity)}
            className="flex w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <OrganizationTile
              organization={identity.organization}
              size="trigger"
            />
            <TriggerText identity={identity} />
            <ChevronsUpDown
              aria-hidden="true"
              className="ml-auto size-4 text-muted-foreground"
            />
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          side={sidebar?.isMobile ? 'bottom' : 'right'}
          align="start"
          sideOffset={sidebar?.isMobile ? 4 : 8}
          alignOffset={sidebar?.isMobile ? 8 : 0}
          aria-label="Organizations"
          data-testid="organization-popup"
          className="w-[268px] md:w-[260px] max-w-[calc(100vw-1rem)] max-h-[var(--available-height)] overflow-y-auto p-1"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1.5">
              Organizations
            </DropdownMenuLabel>
            {pages.query.isError ? (
              <>
                <DropdownMenuItem disabled className="px-2 py-1">
                  Unable to load organizations.
                </DropdownMenuItem>
                <DropdownMenuItem
                  closeOnClick={false}
                  disabled={pages.query.isFetching}
                  onClick={() => void pages.query.refetch()}
                >
                  Retry
                </DropdownMenuItem>
              </>
            ) : null}
            {!pages.query.isError && busy ? (
              <DropdownMenuItem disabled>
                Switching organization…
              </DropdownMenuItem>
            ) : !pages.query.isError ? (
              organizations.map((organization) => (
                <DropdownMenuItem
                  closeOnClick={false}
                  key={organization.id}
                  aria-current={
                    organization.id === identity.organization.id
                      ? 'true'
                      : undefined
                  }
                  className="h-8 gap-2 px-2 py-0"
                  onClick={async () => {
                    if (organization.id === identity.organization.id) return;
                    setBusy(true);
                    setFailure('');
                    setMessage('');
                    beginExplicitTransition();
                    try {
                      const result = await identityApi.switchOrganization(
                        organization.id,
                      );
                      if (result.status === 'enrollment_required') {
                        setMessage(
                          'Set up or verify your authenticator to enter this organization. Your current organization is unchanged.',
                        );
                        finishExplicitTransition({
                          message:
                            'Set up or verify your authenticator to enter this organization. Your current organization is unchanged.',
                          securityLink: true,
                        });
                        return;
                      }
                      await transitionTenant(query, result.organization);
                      fullReload('/workspace');
                    } catch (error) {
                      try {
                        await refreshIdentity();
                      } catch {
                        // Keep the shell suppressed until the next verified refresh.
                      }
                      finishExplicitTransition({
                        message: identityMessage(error),
                      });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <span aria-hidden="true" className="contents">
                    <OrganizationTile organization={organization} size="item" />
                  </span>
                  {orgLabel(organization)}
                  {organization.id === identity.organization.id ? (
                    <Check aria-hidden="true" className="ml-auto size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))
            ) : null}
            {pages.canGoToFirstPage ? (
              <DropdownMenuItem closeOnClick={false} onClick={pages.firstPage}>
                First page
              </DropdownMenuItem>
            ) : null}
            {pages.canGoToNextPage ? (
              <DropdownMenuItem closeOnClick={false} onClick={pages.nextPage}>
                Next page
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {message ? (
            <>
              <p role="status" className="px-2 py-1 text-sm">
                {message}
              </p>
              <DropdownMenuItem
                render={<Link href="/workspace?settings=security" />}
              >
                Account security
              </DropdownMenuItem>
            </>
          ) : null}
          {failure ? (
            <p role="alert" className="px-2 py-1">
              {failure}
            </p>
          ) : null}
          <DropdownMenuItem
            className="h-8 gap-2 px-2 py-0 text-muted-foreground"
            onClick={() => {
              setCreateOpen(true);
              setOpen(false);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            Create a team
          </DropdownMenuItem>
        </DropdownMenuContent>
        {open && pages.query.isError ? (
          <p
            role="alert"
            data-testid="organization-load-alert"
            className="sr-only"
          >
            Unable to load organizations.
          </p>
        ) : null}
      </DropdownMenu>
      <DialogContent aria-describedby="create-team-description">
        <DialogHeader>
          <DialogTitle>Create a team</DialogTitle>
          <DialogDescription id="create-team-description">
            Create a team organization. Your current organization will remain
            selected.
          </DialogDescription>
        </DialogHeader>
        <CreateTeam
          onCreated={async () => {
            await query.invalidateQueries({ queryKey: ['organizations'] });
            setCreateOpen(false);
          }}
        />
        <DialogClose
          render={
            <Button variant="outline" className="w-full">
              Cancel
            </Button>
          }
        >
          Cancel
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
