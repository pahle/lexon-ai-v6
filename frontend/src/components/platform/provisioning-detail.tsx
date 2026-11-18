'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';
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
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
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
import { PlatformActions, PlatformCard } from './platform-card';
import { PlatformField } from './platform-field';
import { PlatformHeading } from './platform-page';
import {
  capitalize,
  formatPlatformDate,
  formatPlatformDateTime,
} from './platform-format';

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
  const [pendingOperation, setPendingOperation] = useState<
    'resend' | 'cancel' | 'replace' | null
  >(null);
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
      <div
        role="status"
        aria-label="Loading provisioning metadata"
        className="flex flex-col gap-6"
      >
        <h1 className="sr-only">Organization provisioning details</h1>
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="w-1/3" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  const organization = result.data;
  return (
    <>
      <Link
        href="/platform/provisioning"
        className="-mb-3 -ml-2.5 inline-flex w-fit items-center gap-2 self-start rounded-[8px] px-2.5 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Provisioning
      </Link>
      <PlatformHeading
        title={organization.name}
        description={`${organization.slug} · Provisioned ${formatPlatformDate(organization.createdAt)}`}
        aside={
          <Badge variant="outline" className="border-input">
            {capitalize(organization.state)}
          </Badge>
        }
      />
      {failure && !confirmCancel ? (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <PlatformCard title="Owner invitation">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm md:grid-cols-[160px_1fr]">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium">
            {capitalize(organization.invitation.status)}
          </dd>
          <dt className="text-muted-foreground">Expires</dt>
          <dd className="font-medium">
            {formatPlatformDateTime(organization.invitation.expiresAt)}
          </dd>
        </dl>
        <PlatformActions className="justify-start">
          <PendingButton
            variant="outline"
            pending={submission.pending && pendingOperation === 'resend'}
            disabled={submission.pending}
            pendingLabel="Resending…"
            onClick={() =>
              void submission.run(async () => {
                setPendingOperation('resend');
                try {
                  await mutate(
                    () => identityApi.resendOwnerInvitation(organizationId),
                    'Owner invitation resent.',
                  );
                } finally {
                  setPendingOperation(null);
                }
              })
            }
          >
            Resend owner invitation
          </PendingButton>
          <Button
            variant="outline"
            className="text-lexon-red-text"
            disabled={submission.pending}
            onClick={() => {
              setFailure('');
              setConfirmCancel(true);
            }}
          >
            Cancel provisioning
          </Button>
        </PlatformActions>
      </PlatformCard>
      <PlatformCard
        title="Replace owner email"
        description="Sends a new invitation to a different person. The current invitation stops working."
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((input) =>
            submission.run(async () => {
              setPendingOperation('replace');
              try {
                await mutate(async () => {
                  await identityApi.replaceOwnerEmail(organizationId, input);
                  form.reset();
                }, 'Owner invitation updated.');
              } finally {
                setPendingOperation(null);
              }
            }),
          )}
        >
          <PlatformField
            label="Replacement owner email"
            type="email"
            autoComplete="email"
            placeholder="owner@firm.co.id"
            disabled={submission.pending}
            registration={form.register('email')}
            error={form.formState.errors.email}
          />
          <PlatformActions>
            <PendingButton
              type="submit"
              pending={submission.pending && pendingOperation === 'replace'}
              disabled={submission.pending}
              pendingLabel="Replacing…"
            >
              Replace owner email
            </PendingButton>
          </PlatformActions>
        </form>
      </PlatformCard>
      <AlertDialog
        open={confirmCancel}
        onOpenChange={(open) => {
          if (!open && !submission.pending) {
            setConfirmCancel(false);
            setFailure('');
          }
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
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.pending}>
              Keep provisioning
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submission.pending}
              render={
                <PendingButton
                  pending={submission.pending && pendingOperation === 'cancel'}
                  disabled={submission.pending}
                  pendingLabel="Cancelling…"
                  variant="destructive"
                >
                  Cancel provisioning
                </PendingButton>
              }
              onClick={(event) => {
                event.preventDefault();
                void submission.run(async () => {
                  setPendingOperation('cancel');
                  try {
                    if (
                      await mutate(
                        () => identityApi.cancelProvisioning(organizationId),
                        'Provisioning cancelled.',
                      )
                    ) {
                      setConfirmCancel(false);
                      window.location.assign('/platform/provisioning');
                    }
                  } finally {
                    setPendingOperation(null);
                  }
                });
              }}
            >
              Cancel provisioning
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
