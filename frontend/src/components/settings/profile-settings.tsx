'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ProfileInputSchema, type ProfileInput } from '@lexon/contracts';
import { useWorkspace } from '../shell/workspace-provider';
import { AuthCard } from '../auth/auth-card';
import { FormInput } from '../auth/form-input';
import { FieldError, FieldGroup } from '../ui/field';
import { Button } from '../ui/button';
import { identityApi, identityMessage } from '../organizations/page-state';

export function ProfileSettings(): React.ReactElement {
  const { identity, refreshIdentity } = useWorkspace();
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const form = useForm<ProfileInput>({
    resolver: zodResolver(ProfileInputSchema),
    defaultValues: { name: identity?.user.name ?? '' },
  });

  if (!identity) return <p role="status">Loading profile…</p>;

  return (
    <AuthCard title="Profile" headingLevel={2}>
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
          setFailure('');
          setMessage('');
          try {
            await identityApi.updateProfile(input);
            await refreshIdentity();
            setMessage('Profile updated.');
          } catch (error) {
            setFailure(identityMessage(error));
          }
        })}
      >
        <FieldGroup>
          <FormInput
            label="Display name"
            autoComplete="name"
            registration={form.register('name')}
            error={form.formState.errors.name}
          />
          <label className="flex flex-col gap-2 text-sm">
            Email address
            <input
              aria-label="Email address"
              readOnly
              value={identity.user.email}
              className="min-h-11 border border-border bg-muted px-3"
            />
          </label>
          <Link href="/settings/security">Manage account security</Link>
          {failure ? <FieldError>{failure}</FieldError> : null}
          <p role="status">{message}</p>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Save profile
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
