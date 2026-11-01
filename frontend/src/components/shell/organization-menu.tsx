'use client';
import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { useQueryClient } from '@tanstack/react-query';
import type { IdentitySummary, OrganizationSummary } from '@lexon/contracts';
import { transitionTenant } from '../../lib/tenant-queries';
import { fullReload } from '../../lib/full-reload';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { CreateTeam } from '../organizations/create-team';
import {
  identityApi,
  identityMessage,
  useCursorPage,
} from '../organizations/page-state';

function orgLabel(org: OrganizationSummary) {
  return org.kind === 'personal' ? 'Personal' : org.name;
}

export function OrganizationMenu({ identity }: { identity: IdentitySummary }) {
  const query = useQueryClient();
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
  return (
    <Dialog
      open={createOpen}
      onOpenChange={(nextOpen) => {
        setCreateOpen(nextOpen);
        if (nextOpen) setOpen(false);
      }}
    >
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          aria-label={`Organization: ${orgLabel(identity.organization)}`}
          className="flex min-h-11 w-full items-center justify-between rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="truncate">{orgLabel(identity.organization)}</span>
          <span aria-hidden="true">⌄</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side="bottom"
            align="start"
            sideOffset={4}
            className="z-50"
          >
            <Popover.Popup className="w-72 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md">
              <p className="px-2 py-1 text-sm font-medium">Organizations</p>
              {busy ? (
                <p role="status" className="p-2">
                  Switching organization…
                </p>
              ) : (
                organizations.map((organization) => (
                  <Button
                    key={organization.id}
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={organization.id === identity.organization.id}
                    onClick={async () => {
                      setBusy(true);
                      setFailure('');
                      setMessage('');
                      try {
                        const result = await identityApi.switchOrganization(
                          organization.id,
                        );
                        if (result.status === 'enrollment_required') {
                          setMessage(
                            'Set up or verify your authenticator to enter this organization. Your current organization is unchanged.',
                          );
                          return;
                        }
                        await transitionTenant(query, result.organization);
                        fullReload('/workspace');
                      } catch (error) {
                        setFailure(identityMessage(error));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {orgLabel(organization)}
                  </Button>
                ))
              )}
              {pages.pagination}
              {message ? (
                <p role="status" className="p-2">
                  {message}{' '}
                  <a href="/account/security" className="underline">
                    Account security
                  </a>
                </p>
              ) : null}
              {failure ? (
                <p role="alert" className="p-2">
                  {failure}
                </p>
              ) : null}
              <DialogTrigger
                render={
                  <Button variant="outline" className="mt-2 w-full">
                    Create a team
                  </Button>
                }
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
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
      </DialogContent>
    </Dialog>
  );
}
