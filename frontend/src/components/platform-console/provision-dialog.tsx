'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ProvisioningInputSchema,
  type ProvisioningInput,
} from '@lexon/contracts';
import {
  IdentityClientError,
  SLUG_TAKEN_MESSAGE,
} from '../../lib/identity-client';
import { identityApi, identityMessage } from '../organizations/page-state';
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

/** Same call and form rules as the provisioning form; success opens the new record. */
export function ProvisionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const submission = useSubmissionLock();
  const [failure, setFailure] = useState('');
  const form = useForm<ProvisioningInput>({
    resolver: zodResolver(ProvisioningInputSchema),
    defaultValues: { name: '', slug: '', ownerEmail: '' },
  });

  function close(next: boolean) {
    if (!next) {
      form.reset();
      setFailure('');
    }
    onOpenChange(next);
  }

  async function provision(input: ProvisioningInput) {
    setFailure('');
    await submission.run(async () => {
      try {
        const created = await identityApi.createProvisioning(input);
        void queryClient.invalidateQueries({
          queryKey: ['platform', 'organizations'],
        });
        toast.success('Organization provisioning started.');
        close(false);
        router.push(`/platform/organizations/${created.id}`);
      } catch (error) {
        if (
          error instanceof IdentityClientError &&
          error.code === 'ORG_SLUG_TAKEN'
        )
          form.setError('slug', { message: SLUG_TAKEN_MESSAGE });
        else setFailure(identityMessage(error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Provision a team organization</DialogTitle>
          <DialogDescription>
            The organization has no members or content until its first owner
            accepts the invitation.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={form.handleSubmit(provision)}
          className="flex flex-col gap-4"
        >
          <PlatformField
            label="Organization name"
            placeholder="Hukum Nusantara"
            registration={form.register('name')}
            error={form.formState.errors.name}
          />
          <PlatformField
            label="Organization slug"
            placeholder="hukum-nusantara"
            hint="Lowercase letters, numbers, and hyphens."
            registration={form.register('slug')}
            error={form.formState.errors.slug}
          />
          <PlatformField
            label="First owner email"
            type="email"
            autoComplete="email"
            placeholder="owner@firm.co.id"
            registration={form.register('ownerEmail')}
            error={form.formState.errors.ownerEmail}
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
              pendingLabel="Provisioning…"
            >
              <PlusIcon aria-hidden="true" />
              Provision organization
            </PendingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
