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
import { Mail } from 'lucide-react';
import { formatDayMonthYear } from '../../lib/date-time';
import { Input } from '../ui/input';
import { SettingsHeading } from '../settings/settings-section';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
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
      className="flex flex-col gap-3"
    >
      <SettingsHeading
        id="invitations-heading"
        title="Invitations"
        description="Invite people by email. An invitation expires after 7 days."
      />
      {failure && !cancelling ? (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <form
        noValidate
        onSubmit={form.handleSubmit(sendInvitation)}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-center gap-2 max-md:flex-wrap">
          <Input
            type="email"
            autoComplete="email"
            aria-label="Invitation email"
            placeholder="name@firm.co.id"
            disabled={submission.pending}
            aria-invalid={!!form.formState.errors.email}
            aria-describedby={
              form.formState.errors.email ? 'invitation-email-error' : undefined
            }
            className="flex-1 max-md:basis-full"
            {...form.register('email')}
          />
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
              className="data-[size=default]:h-8 gap-1.5 px-3 text-sm font-medium"
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
          <PendingButton
            type="submit"
            className="bg-clip-border"
            pending={submission.pending && pendingAction?.type === 'send'}
            disabled={submission.pending}
            pendingLabel="Sending…"
          >
            Send invitation
          </PendingButton>
        </div>
        {form.formState.errors.email ? (
          <FieldError id="invitation-email-error">
            {form.formState.errors.email.message}
          </FieldError>
        ) : null}
      </form>
      {rows.length > 0 ? (
        <h3 className="-mt-3 -mb-3 pt-5 pb-1 text-sm leading-[normal] font-semibold">
          Pending invitations
        </h3>
      ) : null}
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
        <div className="min-w-0">
          <Table className="w-full">
            <TableHeader className="sr-only">
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((invitation) => {
                const actionable =
                  invitation.status === 'pending' ||
                  invitation.status === 'expired';
                const role =
                  invitation.role === 'admin'
                    ? 'Admin'
                    : invitation.role === 'owner'
                      ? 'Owner'
                      : 'Member';
                const expiry = formatDayMonthYear(invitation.expiresAt);
                return (
                  <TableRow
                    key={invitation.id}
                    className="hover:bg-transparent"
                  >
                    <TableCell className="w-full px-0 py-3 whitespace-normal">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-8 flex-none items-center justify-center rounded-lg bg-sidebar-accent"
                        >
                          <Mail className="size-4" />
                        </span>
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="font-medium">
                            {invitation.email}
                          </span>
                          <span className="text-xs leading-tight text-muted-foreground max-md:max-w-[170px]">
                            {role} ·{' '}
                            <span
                              className={
                                invitation.status === 'expired'
                                  ? 'text-lexon-red-text'
                                  : ''
                              }
                            >
                              {invitation.status === 'pending'
                                ? `Expires ${expiry}`
                                : invitation.status === 'expired'
                                  ? `Expired ${expiry}`
                                  : invitation.status}
                            </span>
                          </span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="w-px px-0 py-3 pl-3 text-right">
                      {actionable ? (
                        <div className="flex justify-end gap-2">
                          <PendingButton
                            variant="outline"
                            size="sm"
                            className="h-[30px] px-2.5 text-[13px] [&_.invisible]:hidden"
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
                            variant="ghost"
                            size="sm"
                            className="h-[30px] px-2.5 text-[13px] text-muted-foreground"
                            disabled={submission.pending}
                            onClick={() => {
                              setFailure('');
                              setCancelling(invitation);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : null}
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
          if (!open && !submission.pending) {
            setCancelling(null);
            setFailure('');
          }
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
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
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
