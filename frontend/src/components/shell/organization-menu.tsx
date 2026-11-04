'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import type { IdentitySummary, OrganizationSummary } from '@lexon/contracts';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { transitionTenant } from '../../lib/tenant-queries';
import { fullReload } from '../../lib/full-reload';
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
  const organizations = pages.query.data?.items ?? [identity.organization];
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
                aria-label={`Organization: ${orgLabel(identity.organization)} ${organizationRole(identity.organization)}`}
                title={collapsed ? orgLabel(identity.organization) : undefined}
                render={
                  <SidebarMenuButton
                    size="lg"
                    tooltip={orgLabel(identity.organization)}
                    className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0!"
                  />
                }
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <LexonLogo variant="mark-tile" width={32} />
                </div>
                {!collapsed ? (
                  <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {orgLabel(identity.organization)}
                    </span>{' '}
                    <span className="truncate text-xs text-muted-foreground">
                      {organizationRole(identity.organization)}
                    </span>
                  </span>
                ) : null}
                {!collapsed ? (
                  <ChevronsUpDown
                    aria-hidden="true"
                    className="ml-auto size-4"
                  />
                ) : null}
              </DropdownMenuTrigger>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <DropdownMenuTrigger
            ref={organizationTrigger}
            aria-label={`Organization: ${orgLabel(identity.organization)} ${organizationRole(identity.organization)}`}
            className="flex w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <LexonLogo variant="mark-tile" width={32} />
            </span>
            <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">
                {orgLabel(identity.organization)}
              </span>{' '}
              <span className="truncate text-xs text-muted-foreground">
                {organizationRole(identity.organization)}
              </span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="ml-auto size-4" />
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          side={sidebar?.isMobile ? 'bottom' : 'right'}
          align="start"
          sideOffset={4}
          aria-label="Organizations"
          data-testid="organization-popup"
          className="w-fit min-w-60 max-w-[calc(100vw-1rem)] max-h-[var(--available-height)] overflow-y-auto p-1"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1">
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
                  className="gap-2 p-2"
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
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md"
                  >
                    {organization.kind === 'personal' ? (
                      <>
                        <LexonLogo
                          variant="monogram"
                          width={24}
                          className="dark:hidden"
                        />
                        <LexonLogo
                          variant="monogram"
                          inverse
                          width={24}
                          className="hidden dark:block"
                        />
                      </>
                    ) : (
                      <LexonLogo variant="mark-tile" width={24} />
                    )}
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
            className="gap-2 p-2"
            onClick={() => {
              setCreateOpen(true);
              setOpen(false);
            }}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed bg-transparent">
              <Plus aria-hidden="true" className="size-4" />
            </span>
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
      <DialogContent
        aria-describedby="create-team-description"
        className="rounded-md"
      >
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
