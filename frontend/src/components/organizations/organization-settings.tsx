'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  OrganizationSettingsInputSchema,
  type OrganizationSettingsInput,
  type OrganizationSummary,
} from '@lexon/contracts';
import { AuthCard } from '../auth/auth-card';
import { FormInput } from '../auth/form-input';
import { FieldGroup, FieldError } from '../ui/field';
import { Button } from '../ui/button';
import { identityApi, identityMessage } from './page-state';
export function OrganizationSettings({
  organization,
}: {
  organization: OrganizationSummary;
}) {
  const [current, setCurrent] = useState(organization);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<OrganizationSettingsInput>({
    resolver: zodResolver(OrganizationSettingsInputSchema),
    defaultValues: { name: organization.name, slug: organization.slug },
  });
  if (organization.kind === 'personal' || organization.role !== 'owner')
    return (
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <AuthCard title="Organization settings" headingLevel={2}>
          <p>
            Only team owners can change organization settings. Personal cannot
            be renamed.
          </p>
        </AuthCard>
      </div>
    );
  async function update(input: OrganizationSettingsInput) {
    setBusy(true);
    setFailure('');
    try {
      setCurrent(await identityApi.updateOrganization(organization.id, input));
      setMessage('Organization settings updated.');
    } catch (error) {
      setFailure(identityMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <AuthCard
        title="Organization settings"
        headingLevel={2}
        description="Manage your team name and authentication requirements."
      >
        <form noValidate onSubmit={form.handleSubmit(update)}>
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
            <Button
              type="submit"
              disabled={busy}
              className="h-auto min-w-0 max-w-full whitespace-normal text-left leading-5"
            >
              Save organization settings
            </Button>
          </FieldGroup>
        </form>
        <p>Authenticator required: {current.require2fa ? 'Yes' : 'No'}</p>
        <Button
          variant="outline"
          disabled={busy}
          className="h-auto min-w-0 max-w-full whitespace-normal text-left leading-5"
          onClick={() => void update({ require2fa: !current.require2fa })}
        >
          {current.require2fa
            ? 'Remove authenticator requirement'
            : 'Require authenticator'}
        </Button>
        {failure ? <FieldError>{failure}</FieldError> : null}
        <p role="status">{message}</p>
      </AuthCard>
    </div>
  );
}
