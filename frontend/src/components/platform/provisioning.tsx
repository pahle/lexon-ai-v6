'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ProvisioningInputSchema,
  type ProvisioningInput,
} from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
  useCursorPage,
} from '../organizations/page-state';
import { AuthCard } from '../auth/auth-card';
import { FormInput } from '../auth/form-input';
import { FieldGroup, FieldError } from '../ui/field';
import { Button } from '../ui/button';
export function ProvisioningList() {
  const query = useQueryClient();
  const [failure, setFailure] = useState('');
  const list = useCursorPage(['platform', 'provisioning'], (cursor) =>
    identityApi.listProvisioning({ limit: 20, ...(cursor ? { cursor } : {}) }),
  );
  const form = useForm<ProvisioningInput>({
    resolver: zodResolver(ProvisioningInputSchema),
    defaultValues: { name: '', slug: '', ownerEmail: '' },
  });
  if (list.query.error) return <QueryFailure error={list.query.error} />;
  if (!list.query.data) return <p role="status">Checking platform access…</p>;
  return (
    <div className="flex flex-col gap-6">
      <a href="/workspace">Return to workspace</a>
      <a href="/platform/accounts">Account status</a>
      <AuthCard
        title="Provision a team organization"
        description="A provisioning team has no members or content until its first owner accepts the invitation."
      >
        <form
          noValidate
          onSubmit={form.handleSubmit(async (input) => {
            setFailure('');
            try {
              await identityApi.createProvisioning(input);
              form.reset();
              await query.invalidateQueries({
                queryKey: ['platform', 'provisioning'],
              });
            } catch (error) {
              setFailure(identityMessage(error));
            }
          })}
        >
          <FieldGroup>
            <FormInput
              label="Organization name"
              registration={form.register('name')}
              error={form.formState.errors.name}
            />
            <FormInput
              label="Organization slug"
              registration={form.register('slug')}
              error={form.formState.errors.slug}
            />
            <FormInput
              label="First owner email"
              type="email"
              registration={form.register('ownerEmail')}
              error={form.formState.errors.ownerEmail}
            />
            {failure ? <FieldError>{failure}</FieldError> : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Provision organization
            </Button>
          </FieldGroup>
        </form>
        <ul>
          {list.query.data.items.map((org) => (
            <li key={org.id}>
              <a href={'/platform/provisioning/' + org.id}>{org.name}</a>
              <span>
                {' '}
                — {org.state}; invitation {org.invitation.status}
              </span>
            </li>
          ))}
        </ul>
        {list.pagination}
      </AuthCard>
    </div>
  );
}
