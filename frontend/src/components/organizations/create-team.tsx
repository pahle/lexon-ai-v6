'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CreateOrganizationInputSchema,
  type CreateOrganizationInput,
} from '@lexon/contracts';
import { FormInput } from '../auth/form-input';
import { FieldGroup } from '../ui/field';
import { Alert, AlertDescription } from '../ui/alert';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { identityApi, identityMessage } from './page-state';
export function CreateTeam({ onCreated }: { onCreated?: () => Promise<void> }) {
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(CreateOrganizationInputSchema),
    defaultValues: { name: '', slug: '' },
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((input) =>
        submission.run(async () => {
          setFailure('');
          try {
            await identityApi.createOrganization(input);
            form.reset();
            await onCreated?.();
            toast.success(
              'Team created. Your current organization is unchanged.',
            );
          } catch (error) {
            setFailure(identityMessage(error));
          }
        }),
      )}
    >
      <FieldGroup>
        <FormInput
          label="Team name"
          registration={form.register('name')}
          error={form.formState.errors.name}
        />
        <FormInput
          label="Team slug"
          registration={form.register('slug')}
          error={form.formState.errors.slug}
        />
        {failure ? (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        <PendingButton
          type="submit"
          pending={submission.pending}
          pendingLabel="Creating team…"
        >
          Create team
        </PendingButton>
      </FieldGroup>
    </form>
  );
}
