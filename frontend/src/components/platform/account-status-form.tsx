'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { UuidSchema } from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
} from '../organizations/page-state';
import { PlatformActions, PlatformCard } from './platform-card';
import { PlatformField } from './platform-field';
import { Alert, AlertDescription } from '../ui/alert';
import { Skeleton } from '../ui/skeleton';
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

const schema = z.strictObject({ userId: UuidSchema });

export function AccountStatusForm() {
  const access = useQuery({
    queryKey: ['platform', 'access'],
    queryFn: () => identityApi.listProvisioning({ limit: 1 }),
    retry: false,
  });
  const [failure, setFailure] = useState('');
  const [confirmDisable, setConfirmDisable] = useState(false);
  const submission = useSubmissionLock();
  const form = useForm<{ userId: string }>({
    resolver: zodResolver(schema),
    defaultValues: { userId: '' },
  });

  async function update(userId: string, disabled: boolean) {
    setFailure('');
    await submission.run(async () => {
      try {
        await identityApi.setAccountDisabled(userId, disabled);
        toast.success(disabled ? 'Account disabled.' : 'Account enabled.');
        if (disabled) setConfirmDisable(false);
      } catch (error) {
        setFailure(identityMessage(error));
      }
    });
  }

  if (access.error) return <QueryFailure error={access.error} />;
  if (!access.data) {
    return (
      <div
        role="status"
        aria-label="Checking platform access"
        className="flex flex-col gap-6"
      >
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  return (
    <>
      <PlatformCard
        title="Find an account"
        description="Enter the user ID from the audit log or a support request."
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(() => setConfirmDisable(true))}
        >
          <PlatformField
            label="User ID"
            autoComplete="off"
            placeholder="usr_01J…"
            registration={form.register('userId')}
            error={form.formState.errors.userId}
          />
          {failure ? (
            <Alert variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <PlatformActions>
            <PendingButton
              type="button"
              variant="outline"
              pending={submission.pending}
              pendingLabel="Enabling…"
              onClick={form.handleSubmit((input) =>
                update(input.userId, false),
              )}
            >
              Enable account
            </PendingButton>
            <PendingButton
              type="submit"
              variant="destructive"
              pending={submission.pending}
              pendingLabel="Disabling…"
            >
              Disable account
            </PendingButton>
          </PlatformActions>
        </form>
      </PlatformCard>
      <AlertDialog
        open={confirmDisable}
        onOpenChange={(open) => {
          if (!open && !submission.pending) setConfirmDisable(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disable account {form.getValues('userId')}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This prevents the account from signing in. Its existing
              organization data is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failure ? (
            <Alert variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.pending}>
              Keep account enabled
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submission.pending}
              render={
                <PendingButton
                  pending={submission.pending}
                  pendingLabel="Disabling…"
                  variant="destructive"
                >
                  Disable account
                </PendingButton>
              }
              onClick={(event) => {
                event.preventDefault();
                void update(form.getValues('userId'), true);
              }}
            >
              Disable account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
