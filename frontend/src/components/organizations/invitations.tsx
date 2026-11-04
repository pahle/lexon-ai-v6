'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  InvitationInputSchema,
  type InvitationInput,
  type InvitationSummary,
  type OrganizationSummary,
} from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
  useCursorPage,
} from './page-state';
import { FormInput } from '../auth/form-input';
import { Button } from '../ui/button';
import { FieldGroup } from '../ui/field';
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

export function Invitations({
  organization,
}: {
  organization: OrganizationSummary;
}) {
  const queryClient = useQueryClient();
  const submission = useSubmissionLock();
  const [failure, setFailure] = useState('');
  const [cancelling, setCancelling] = useState<InvitationSummary | null>(null);
  const [pendingAction, setPendingAction] = useState<
    | { type: 'send' }
    | { type: 'resend' | 'cancel'; invitationId: string }
    | null
  >(null);
  const form = useForm<InvitationInput>({
    resolver: zodResolver(InvitationInputSchema),
    defaultValues: { email: '', role: 'member' },
  });
  const allowed =
    organization.kind === 'team' && organization.role !== 'member';
  const { query: invitations, pagination } = useCursorPage(
    ['tenant', organization.id, 'invitations'],
    (cursor) =>
      identityApi.listOrganizationInvitations(organization.id, {
        limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
    allowed,
  );

  if (!allowed)
    return <p>Invitation management is available to team owners and admins.</p>;

  const invalidateInvitations = () =>
    queryClient.invalidateQueries({
      queryKey: ['tenant', organization.id, 'invitations'],
    });
  async function mutate(action: () => Promise<unknown>, success: string) {
    setFailure('');
    try {
      await action();
      await invalidateInvitations();
      toast.success(success);
      return true;
    } catch (error) {
      setFailure(identityMessage(error));
      return false;
    }
  }
  async function sendInvitation(input: InvitationInput) {
    await submission.run(async () => {
      setPendingAction({ type: 'send' });
      try {
        if (
          await mutate(
            () => identityApi.createInvitation(organization.id, input),
            'Invitation sent.',
          )
        ) {
          form.reset();
        }
      } finally {
        setPendingAction(null);
      }
    });
  }
  async function cancelInvitation() {
    if (!cancelling) return;
    const invitationId = cancelling.id;
    await submission.run(async () => {
      setPendingAction({ type: 'cancel', invitationId });
      try {
        if (
          await mutate(
            () => identityApi.cancelInvitation(invitationId),
            'Invitation cancelled.',
          )
        ) {
          setCancelling(null);
        }
      } finally {
        setPendingAction(null);
      }
    });
  }
  const rows = invitations.data?.items ?? [];

  return (
    <section
      aria-labelledby="invitations-heading"
      className="flex flex-col gap-5"
    >
      <header>
        <h2 id="invitations-heading" className="text-lg font-medium">
          Invitations
        </h2>
        <p className="text-sm text-muted-foreground">
          Invite people by email. The Expires column shows each invitation’s
          expiration date.
        </p>
      </header>
      {failure ? (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <form noValidate onSubmit={form.handleSubmit(sendInvitation)}>
        <FieldGroup className="grid gap-3 min-[768px]:grid-cols-[minmax(0,1fr)_6rem_auto] min-[768px]:items-start">
          <FormInput
            label="Invitation email"
            type="email"
            autoComplete="email"
            disabled={submission.pending}
            registration={form.register('email')}
            error={form.formState.errors.email}
          />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Role</span>
            <Select
              value={form.watch('role')}
              onValueChange={(value) => {
                if (value === 'member' || value === 'admin')
                  form.setValue('role', value, { shouldDirty: true });
              }}
            >
              <SelectTrigger
                aria-label="Invitation role"
                disabled={submission.pending}
              >
                <SelectValue>
                  {form.watch('role') === 'admin' ? 'Admin' : 'Member'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="member">Member</SelectItem>
                  {organization.role === 'owner' ? (
                    <SelectItem value="admin">Admin</SelectItem>
                  ) : null}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-7">
            <PendingButton
              type="submit"
              pending={submission.pending && pendingAction?.type === 'send'}
              disabled={submission.pending}
              pendingLabel="Sending…"
            >
              Send invitation
            </PendingButton>
          </div>
        </FieldGroup>
      </form>
      {invitations.error ? <QueryFailure error={invitations.error} /> : null}
      {!invitations.error && !invitations.data ? (
        <div
          role="status"
          aria-label="Loading invitations"
          className="flex flex-col gap-3"
        >
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : null}
      {invitations.data && rows.length === 0 ? (
        <Empty className="min-h-56 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <span aria-hidden="true">✉</span>
            </EmptyMedia>
            <EmptyTitle>No pending invitations</EmptyTitle>
            <EmptyDescription>
              Invite people by email to work in this organization.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() =>
                document
                  .querySelector<HTMLInputElement>('input[name="email"]')
                  ?.focus()
              }
            >
              Invite people
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
      {rows.length > 0 ? (
        <div className="min-w-0 overflow-x-auto">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((invitation) => {
                const actionable =
                  invitation.status === 'pending' ||
                  invitation.status === 'expired';
                return (
                  <TableRow key={invitation.id}>
                    <TableCell>{invitation.email}</TableCell>
                    <TableCell>
                      {invitation.role === 'admin'
                        ? 'Admin'
                        : invitation.role === 'owner'
                          ? 'Owner'
                          : 'Member'}
                    </TableCell>
                    <TableCell>
                      {new Date(invitation.expiresAt).toLocaleDateString(
                        'en-US',
                        { month: 'short', day: 'numeric', year: 'numeric' },
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {actionable ? (
                        <div className="flex justify-end gap-2">
                          <PendingButton
                            variant="outline"
                            pending={
                              submission.pending &&
                              pendingAction?.type === 'resend' &&
                              pendingAction.invitationId === invitation.id
                            }
                            disabled={submission.pending}
                            pendingLabel="Resending…"
                            onClick={() =>
                              void submission.run(async () => {
                                setPendingAction({
                                  type: 'resend',
                                  invitationId: invitation.id,
                                });
                                try {
                                  await mutate(
                                    () =>
                                      identityApi.resendInvitation(
                                        invitation.id,
                                      ),
                                    'Invitation resent.',
                                  );
                                } finally {
                                  setPendingAction(null);
                                }
                              })
                            }
                          >
                            Resend
                          </PendingButton>
                          <Button
                            variant="outline"
                            disabled={submission.pending}
                            onClick={() => setCancelling(invitation)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <span className="capitalize text-muted-foreground">
                          {invitation.status}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {pagination}
      <AlertDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open && !submission.pending) setCancelling(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel the invitation to {cancelling?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This invitation to {organization.name} will no longer be usable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.pending}>
              Keep invitation
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submission.pending}
              render={
                <PendingButton
                  pending={
                    submission.pending && pendingAction?.type === 'cancel'
                  }
                  disabled={submission.pending}
                  pendingLabel="Cancelling…"
                  variant="destructive"
                >
                  Cancel invitation
                </PendingButton>
              }
              onClick={(event) => {
                event.preventDefault();
                void cancelInvitation();
              }}
            >
              Cancel invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
