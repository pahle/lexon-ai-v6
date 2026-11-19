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
import { AuthAlert, authButtonClass } from '../auth/auth-parts';
import { FieldGroup } from '../ui/field';
import { Alert, AlertDescription } from '../ui/alert';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import {
  IdentityClientError,
  SLUG_TAKEN_MESSAGE,
} from '../../lib/identity-client';
import { identityApi, identityMessage } from './page-state';
export function CreateTeam({
  onCreated,
  presentation = 'default',
}: {
  onCreated?: () => Promise<void>;
  presentation?: 'default' | 'auth';
}) {
  const auth = presentation === 'auth';
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
            if (
              error instanceof IdentityClientError &&
              error.code === 'ORG_SLUG_TAKEN'
            ) {
              form.setError('slug', { message: SLUG_TAKEN_MESSAGE });
              return;
            }
            setFailure(identityMessage(error));
          }
        }),
      )}
    >
      <FieldGroup>
        <FormInput
          label="Team name"
          {...(auth ? { placeholder: 'Hukum Nusantara' } : {})}
          registration={form.register('name')}
          error={form.formState.errors.name}
        />
        <FormInput
          label="Team slug"
          {...(auth
            ? {
                placeholder: 'hukum-nusantara',
                hint: 'Lowercase letters, numbers, and hyphens.',
              }
            : {})}
          registration={form.register('slug')}
          error={form.formState.errors.slug}
        />
        {failure ? (
          auth ? (
            <AuthAlert>{failure}</AuthAlert>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )
        ) : null}
        <PendingButton
          type="submit"
          pending={submission.pending}
          pendingLabel="Creating team…"
          {...(auth
            ? {
                size: 'lg' as const,
                variant: 'outline' as const,
                className: authButtonClass,
              }
            : {})}
        >
          Create team
        </PendingButton>
      </FieldGroup>
    </form>
  );
}
