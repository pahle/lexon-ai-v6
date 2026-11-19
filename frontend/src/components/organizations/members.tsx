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
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { initials } from '../../lib/initials';
import { SettingsHeading } from '../settings/settings-section';
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
  const { identity, refreshIdentity } = useWorkspace();
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
      ) {
        setRemoving(null);
        // The sidebar's member count comes from the identity summary.
        try {
          await refreshIdentity();
        } catch {
          // The next verified refresh will update the count.
        }
      }
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

  const currentUserId = identity?.user.id;
  const rows = [...(members.data?.items ?? [])].sort(
    (first, second) =>
      Number(second.userId === currentUserId) -
      Number(first.userId === currentUserId),
  );
  const goToInvitations = () => {
    router.replace(settingsHref(window.location.href, 'invitations'), {
      scroll: false,
    });
  };

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-3">
      <SettingsHeading
        id="members-heading"
        className="gap-y-0"
        title="Members"
        description={
          members.data
            ? `${rows.length} ${rows.length === 1 ? 'member' : 'members'} in ${organization.name}.`
            : undefined
        }
        action={
          canInvite ? (
            <Button className="bg-clip-border" onClick={goToInvitations}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              Invite people
            </Button>
          ) : undefined
        }
      />
      {failure && !removing && !confirmLeave ? (
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
        <div className="min-w-0">
          <Table className="w-full">
            <TableHeader className="sr-only">
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
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((member) => {
                const currentUser = member.userId === currentUserId;
                const manageable =
                  !currentUser &&
                  canManageRoles &&
                  (organization.role === 'owner' || member.role !== 'owner');
                const removable =
                  !currentUser &&
                  (organization.role === 'owner' ||
                    (organization.role === 'admin' &&
                      member.role === 'member'));
                const roleLabel =
                  member.role === 'owner'
                    ? 'Owner'
                    : member.role === 'admin'
                      ? 'Admin'
                      : 'Member';
                return (
                  <TableRow
                    key={member.id}
                    data-testid={'member-' + member.userId}
                    className="hover:bg-transparent"
                  >
                    <TableCell className="w-full px-0 py-3 whitespace-normal max-md:max-w-0">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-8 flex-none items-center justify-center rounded-lg bg-sidebar-accent text-xs font-semibold"
                        >
                          {initials(member.name)}
                        </span>
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate font-medium">
                            {member.name}
                            {member.userId === identity?.user.id
                              ? ' (you)'
                              : ''}
                          </span>
                          <span className="text-xs leading-tight text-muted-foreground max-md:break-all">
                            {member.email}
                          </span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell
                      className="w-px px-0 py-3 pl-3 text-right"
                      colSpan={
                        canManageRoles && !manageable && !removable ? 2 : 1
                      }
                    >
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
                            className="data-[size=default]:h-[30px] gap-1 rounded-lg px-2.5 text-[13px] font-medium [&>svg]:size-3.5!"
                          >
                            <SelectValue>{roleLabel}</SelectValue>
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
                        <Badge variant="outline" className="border-input">
                          {roleLabel}
                        </Badge>
                      )}
                    </TableCell>
                    {canManageRoles && (manageable || removable) ? (
                      <TableCell className="w-px px-0 py-3 pl-3 text-right">
                        {removable ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="size-7 rounded-md text-muted-foreground"
                                  aria-label={'More actions for ' + member.name}
                                  disabled={submission.pending}
                                />
                              }
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setFailure('');
                                  setRemoving(member);
                                }}
                              >
                                <Trash2
                                  aria-hidden="true"
                                  data-icon="inline-start"
                                />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
      <div className="-mt-3 flex justify-end pt-4">
        <Button
          variant="outline"
          disabled={submission.pending}
          onClick={() => {
            setFailure('');
            setConfirmLeave(true);
          }}
        >
          Leave organization
        </Button>
      </div>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !submission.pending) {
            setRemoving(null);
            setFailure('');
          }
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
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
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
          if (!open && !submission.pending) {
            setConfirmLeave(false);
            setFailure('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {organization.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will lose access to this organization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
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
