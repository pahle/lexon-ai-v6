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
import { FormInput } from '../auth/form-input';
import { FieldGroup } from '../ui/field';
import { Alert, AlertDescription } from '../ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card';
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
      <section
        role="status"
        aria-label="Checking platform access"
        className="flex flex-col gap-3"
      >
        <p className="text-sm text-muted-foreground">
          Checking platform access…
        </p>
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Account status</CardTitle>
          <CardDescription>
            Disable or enable an account by its user ID. This grants no access
            to its organizations or content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={form.handleSubmit(() => setConfirmDisable(true))}
          >
            <FieldGroup>
              <FormInput
                label="User ID"
                autoComplete="off"
                registration={form.register('userId')}
                error={form.formState.errors.userId}
              />
              {failure ? (
                <Alert variant="destructive">
                  <AlertDescription>{failure}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <PendingButton
                  type="submit"
                  pending={submission.pending}
                  pendingLabel="Disabling…"
                >
                  Disable account
                </PendingButton>
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
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
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
      <a
        className="text-sm underline underline-offset-4"
        href="/workspace?settings=security"
      >
        Account security
      </a>
    </div>
  );
}
