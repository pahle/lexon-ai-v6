'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  PasswordResetRequestInputSchema,
  type PasswordResetRequestInput,
} from '@lexon/contracts';
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

export function ProvisioningDetail({
  organizationId,
}: {
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const result = useQuery({
    queryKey: ['platform', 'provisioning', organizationId],
    queryFn: () => identityApi.getProvisioning(organizationId),
    retry: false,
  });
  const [failure, setFailure] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const submission = useSubmissionLock();
  const form = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestInputSchema),
    defaultValues: { email: '' },
  });

  async function mutate(action: () => Promise<unknown>, success: string) {
    setFailure('');
    try {
      await action();
      await queryClient.invalidateQueries({
        queryKey: ['platform', 'provisioning'],
      });
      toast.success(success);
      return true;
    } catch (error) {
      setFailure(identityMessage(error));
      return false;
    }
  }

  if (result.error) return <QueryFailure error={result.error} />;
  if (!result.data) {
    return (
      <section
        role="status"
        aria-label="Loading provisioning metadata"
        className="flex flex-col gap-3"
      >
        <p className="text-sm text-muted-foreground">
          Loading provisioning metadata…
        </p>
        <Skeleton className="h-32 w-full" />
      </section>
    );
  }
  const organization = result.data;
  return (
    <div className="flex flex-col gap-6">
      {failure ? (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{organization.name}</CardTitle>
          <CardDescription>
            Provisioning metadata and invitation status only.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-medium">State</dt>
            <dd className="capitalize text-muted-foreground">
              {organization.state}
            </dd>
            <dt className="font-medium">Owner invitation</dt>
            <dd className="capitalize text-muted-foreground">
              {organization.invitation.status}
            </dd>
            <dt className="font-medium">Expires</dt>
            <dd className="text-muted-foreground">
              {new Date(organization.invitation.expiresAt).toLocaleString(
                'en-US',
                { dateStyle: 'medium', timeStyle: 'short' },
              )}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <PendingButton
              variant="outline"
              pending={submission.pending}
              pendingLabel="Resending…"
              onClick={() =>
                void submission.run(async () => {
                  await mutate(
                    () => identityApi.resendOwnerInvitation(organizationId),
                    'Owner invitation resent.',
                  );
                })
              }
            >
              Resend owner invitation
            </PendingButton>
            <PendingButton
              variant="outline"
              pending={submission.pending}
              pendingLabel="Cancelling…"
              onClick={() => setConfirmCancel(true)}
            >
              Cancel provisioning
            </PendingButton>
          </div>
          <form
            noValidate
            onSubmit={form.handleSubmit((input) =>
              submission.run(async () => {
                if (
                  await mutate(async () => {
                    await identityApi.replaceOwnerEmail(organizationId, input);
                    form.reset();
                  }, 'Owner invitation updated.')
                )
                  return;
              }),
            )}
          >
            <FieldGroup>
              <FormInput
                label="Replacement owner email"
                type="email"
                autoComplete="email"
                registration={form.register('email')}
                error={form.formState.errors.email}
              />
              <PendingButton
                type="submit"
                pending={submission.pending}
                pendingLabel="Replacing…"
              >
                Replace owner email
              </PendingButton>
            </FieldGroup>
          </form>
          <a
            className="text-sm underline underline-offset-4"
            href="/workspace?settings=security"
          >
            Account security
          </a>
        </CardContent>
      </Card>
      <AlertDialog
        open={confirmCancel}
        onOpenChange={(open) => {
          if (!open && !submission.pending) setConfirmCancel(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel provisioning for {organization.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the provisioning organization and invalidates its
              owner invitation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.pending}>
              Keep provisioning
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submission.pending}
              render={
                <PendingButton
                  pending={submission.pending}
                  pendingLabel="Cancelling…"
                  variant="destructive"
                >
                  Cancel provisioning
                </PendingButton>
              }
              onClick={(event) => {
                event.preventDefault();
                void submission.run(async () => {
                  if (
                    await mutate(
                      () => identityApi.cancelProvisioning(organizationId),
                      'Provisioning cancelled.',
                    )
                  ) {
                    setConfirmCancel(false);
                    window.location.assign('/platform/provisioning');
                  }
                });
              }}
            >
              Cancel provisioning
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
