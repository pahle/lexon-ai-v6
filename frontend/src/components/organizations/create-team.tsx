'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateOrganizationInputSchema,
  type CreateOrganizationInput,
} from '@lexon/contracts';
import { FormInput } from '../auth/form-input';
import { FieldGroup, FieldError } from '../ui/field';
import { Button } from '../ui/button';
import { identityApi, identityMessage } from './page-state';
export function CreateTeam({ onCreated }: { onCreated?: () => Promise<void> }) {
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(CreateOrganizationInputSchema),
    defaultValues: { name: '', slug: '' },
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (input) => {
        setFailure('');
        try {
          await identityApi.createOrganization(input);
          form.reset();
          setMessage('Team created. Your current organization is unchanged.');
          await onCreated?.();
        } catch (error) {
          setFailure(identityMessage(error));
        }
      })}
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
        {failure ? <FieldError>{failure}</FieldError> : null}
        <p role="status">{message}</p>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Create team
        </Button>
      </FieldGroup>
    </form>
  );
}
