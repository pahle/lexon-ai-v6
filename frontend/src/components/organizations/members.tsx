'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type {
  MemberSummary,
  OrganizationSummary,
  OrgRole,
} from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
  useCursorPage,
} from './page-state';
import { Button } from '../ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { Alert, AlertDescription } from '../ui/alert';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { settingsHref } from '../settings/settings-url';
import { useWorkspace } from '../shell/workspace-provider';

export function Members({
  organization,
}: {
  organization: OrganizationSummary;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { identity } = useWorkspace();
  const submission = useSubmissionLock();
  const [failure, setFailure] = useState('');
  const [removing, setRemoving] = useState<MemberSummary | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { query: members, pagination } = useCursorPage(
    ['tenant', organization.id, 'members'],
    (cursor) =>
      identityApi.listMembers(organization.id, {
        limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
    organization.kind === 'team',
  );

  if (organization.kind === 'personal') {
    return (
      <p className="text-sm text-muted-foreground">
        Personal has no team membership controls.
      </p>
    );
  }

  const canInvite =
    organization.role === 'owner' || organization.role === 'admin';
  const canManageRoles =
    organization.role === 'owner' || organization.role === 'admin';
  const invalidateMembers = () =>
    queryClient.invalidateQueries({
      queryKey: ['tenant', organization.id, 'members'],
    });

  async function mutate(action: () => Promise<unknown>, success: string) {
    setFailure('');
    try {
      await action();
      await invalidateMembers();
      toast.success(success);
      return true;
    } catch (error) {
      setFailure(identityMessage(error));
      return false;
    }
  }

  async function changeRole(member: MemberSummary, value: string | null) {
    if (!value || value === member.role) return;
    const role = value as OrgRole;
    await submission.run(async () => {
      await mutate(
        () => identityApi.changeMemberRole(organization.id, member.id, role),
        'Member role updated.',
      );
    });
  }

  async function removeMember() {
    if (!removing) return;
    await submission.run(async () => {
      if (
        await mutate(
          () => identityApi.removeMember(organization.id, removing.id),
          'Member removed.',
        )
      )
        setRemoving(null);
    });
  }

  async function leaveOrganization() {
    let succeeded = false;
    await submission.run(async () => {
      setFailure('');
      try {
        await identityApi.leaveOrganization(organization.id);
        await queryClient.cancelQueries({ queryKey: ['tenant'] });
        queryClient.removeQueries({ queryKey: ['tenant'] });
        toast.success('You left the organization.');
        succeeded = true;
        window.location.assign('/workspace');
      } catch (error) {
        setFailure(identityMessage(error));
      }
    });
    return succeeded;
  }

  const rows = members.data?.items ?? [];
  const goToInvitations = () => {
    router.replace(settingsHref(window.location.href, 'invitations'), {
      scroll: false,
    });
  };

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="members-heading" className="text-lg font-medium">
          Members
        </h2>
        {canInvite ? (
          <Button onClick={goToInvitations}>Invite people</Button>
        ) : null}
      </header>
      {failure ? (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      {members.error ? <QueryFailure error={members.error} /> : null}
      {!members.error && !members.data ? (
        <div
          role="status"
          aria-label="Loading members"
          className="flex flex-col gap-3"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : null}
      {members.data && rows.length === 0 ? (
        <Empty className="min-h-56 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <span aria-hidden="true">◎</span>
            </EmptyMedia>
            <EmptyTitle>No members yet</EmptyTitle>
            <EmptyDescription>
              Invite people to work in this organization.
            </EmptyDescription>
          </EmptyHeader>
          {canInvite ? (
            <EmptyContent>
              <Button variant="outline" onClick={goToInvitations}>
                Invite people
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : null}
      {rows.length > 0 ? (
        <div className="min-w-0 overflow-x-auto">
          <Table className="min-w-[620px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {canManageRoles ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((member) => {
                const manageable =
                  canManageRoles &&
                  (organization.role === 'owner' || member.role !== 'owner');
                const removable =
                  organization.role === 'owner' ||
                  (organization.role === 'admin' && member.role === 'member');
                return (
                  <TableRow
                    key={member.id}
                    data-testid={'member-' + member.userId}
                  >
                    <TableCell className="font-medium">
                      {member.name}
                      {member.userId === identity?.user.id ? ' (you)' : ''}
                    </TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      {manageable ? (
                        <Select
                          value={member.role}
                          onValueChange={(value) =>
                            void changeRole(member, value)
                          }
                        >
                          <SelectTrigger
                            aria-label={'Role for ' + member.name}
                            disabled={submission.pending}
                          >
                            <SelectValue>
                              {member.role === 'owner'
                                ? 'Owner'
                                : member.role === 'admin'
                                  ? 'Admin'
                                  : 'Member'}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {(['owner', 'admin', 'member'] as const)
                                .filter(
                                  (role) =>
                                    role === member.role ||
                                    (role !== member.role &&
                                      (organization.role === 'owner' ||
                                        role !== 'owner')),
                                )
                                .map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {role === 'owner'
                                      ? 'Owner'
                                      : role === 'admin'
                                        ? 'Admin'
                                        : 'Member'}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      ) : (
                        member.role.charAt(0).toUpperCase() +
                        member.role.slice(1)
                      )}
                    </TableCell>
                    {canManageRoles ? (
                      <TableCell className="text-right">
                        {removable ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={submission.pending}
                            onClick={() => setRemoving(member)}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {pagination}
      <div className="flex justify-end border-t pt-4">
        <Button
          variant="outline"
          disabled={submission.pending}
          onClick={() => setConfirmLeave(true)}
        >
          Leave organization
        </Button>
      </div>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !submission.pending) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing?.name} from {organization.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This person will lose access to this organization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submission.pending}
              render={
                <PendingButton
                  pending={submission.pending}
                  pendingLabel="Removing…"
                  variant="destructive"
                >
                  Remove member
                </PendingButton>
              }
              onClick={(event) => {
                event.preventDefault();
                void removeMember();
              }}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={confirmLeave}
        onOpenChange={(open) => {
          if (!open && !submission.pending) setConfirmLeave(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {organization.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will lose access to this organization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submission.pending}
              render={
                <PendingButton
                  pending={submission.pending}
                  pendingLabel="Leaving…"
                  variant="destructive"
                >
                  Leave organization
                </PendingButton>
              }
              onClick={(event) => {
                event.preventDefault();
                void leaveOrganization().then((success) => {
                  if (success) setConfirmLeave(false);
                });
              }}
            >
              Leave organization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
