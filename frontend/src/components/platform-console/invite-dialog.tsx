'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccountInvitationInputSchema,
  type AccountInvitation,
  type AccountInvitationsPage,
} from '@lexon/contracts';
import { identityMessage } from '../organizations/page-state';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { PlatformField } from '../platform/platform-field';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { PlatformApiError, platformConsoleApi } from './api';

type Values = { email: string; name?: string | undefined };

export const COUNT_KEYS = {
  accounts: ['platform', 'counts', 'accounts'],
  invitations: ['platform', 'counts', 'invitations'],
} as const;
export const INVITATIONS_KEY = ['platform', 'account-invitations'] as const;

/** Invite someone to Lexon: email, optional name; the account is created from the emailed link. */
export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const submission = useSubmissionLock();
  const [failure, setFailure] = useState('');
  const form = useForm<Values>({
    // An empty optional name is no name, not an invalid one.
    resolver: (values, context, options) =>
      zodResolver(AccountInvitationInputSchema)(
        { ...values, name: values.name?.trim() || undefined },
        context,
        options,
      ),
    defaultValues: { email: '', name: '' },
  });

  function close(next: boolean) {
    if (!next) {
      form.reset();
      setFailure('');
    }
    onOpenChange(next);
  }

  async function send(values: Values) {
    setFailure('');
    await submission.run(async () => {
      try {
        const created: AccountInvitation = await platformConsoleApi.invite({
          email: values.email,
          ...(values.name?.trim() ? { name: values.name.trim() } : {}),
        });
        // Show the new row first in every cached invitations view; refetch lazily.
        queryClient.setQueriesData<AccountInvitationsPage>(
          { queryKey: INVITATIONS_KEY },
          (page) =>
            page && page.page === 1
              ? {
                  ...page,
                  items: [created, ...page.items].slice(0, page.pageSize),
                  total: page.total + 1,
                }
              : page,
        );
        await queryClient.invalidateQueries({
          queryKey: INVITATIONS_KEY,
          refetchType: 'none',
        });
        void queryClient.invalidateQueries({
          queryKey: COUNT_KEYS.invitations,
        });
        toast.success(`Invitation sent to ${created.email}.`);
        close(false);
      } catch (error) {
        const issue =
          error instanceof PlatformApiError &&
          error.code === 'PLATFORM_INVITATION_CONFLICT'
            ? error.issues.find((i) => i.path === 'email')
            : undefined;
        if (issue) form.setError('email', { message: issue.message });
        else if (
          error instanceof PlatformApiError &&
          error.code === 'AUTH_RATE_LIMITED'
        )
          setFailure('Too many invitations. Wait a moment and try again.');
        else setFailure(identityMessage(error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Invite someone to Lexon</DialogTitle>
          <DialogDescription>
            They get an email with a link to create their account. The link
            works for 7 days. They start in their Personal workspace; teams
            invite them separately.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={form.handleSubmit(send)}
          className="flex flex-col gap-4"
        >
          <PlatformField
            label="Email"
            type="email"
            autoComplete="off"
            registration={form.register('email')}
            error={form.formState.errors.email}
          />
          <PlatformField
            label="Name"
            hint="Optional"
            autoComplete="off"
            registration={form.register('name')}
            error={form.formState.errors.name}
          />
          {failure ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="mt-2 flex-row justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => close(false)}
            >
              Cancel
            </Button>
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Sending"
            >
              Send invitation
            </PendingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
