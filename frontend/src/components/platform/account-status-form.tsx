'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UuidSchema } from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
} from '../organizations/page-state';
import { AuthCard } from '../auth/auth-card';
import { FormInput } from '../auth/form-input';
import { FieldGroup, FieldError } from '../ui/field';
import { Button } from '../ui/button';
const schema = z.strictObject({ userId: UuidSchema });
export function AccountStatusForm() {
  const access = useQuery({
    queryKey: ['platform', 'access'],
    queryFn: () => identityApi.listProvisioning({ limit: 1 }),
    retry: false,
  });
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<{ userId: string }>({
    resolver: zodResolver(schema),
    defaultValues: { userId: '' },
  });
  if (access.error) return <QueryFailure error={access.error} />;
  if (!access.data) return <p role="status">Checking platform access…</p>;
  async function update(userId: string, disabled: boolean) {
    setBusy(true);
    setFailure('');
    setMessage('');
    try {
      await identityApi.setAccountDisabled(userId, disabled);
      setMessage('Account status updated. Revoked sessions remain revoked.');
    } catch (error) {
      setFailure(identityMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <a href="/platform/provisioning">Provisioning</a>
      <AuthCard
        title="Account status"
        description="Disable or enable an account by its user ID. This grants no access to its organizations or content."
      >
        <form
          noValidate
          onSubmit={form.handleSubmit((input) => update(input.userId, true))}
        >
          <FieldGroup>
            <FormInput
              label="User ID"
              registration={form.register('userId')}
              error={form.formState.errors.userId}
            />
            {failure ? <FieldError>{failure}</FieldError> : null}
            <p role="status">{message}</p>
            <Button type="submit" disabled={busy}>
              Disable account
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={form.handleSubmit((input) =>
                update(input.userId, false),
              )}
            >
              Enable account
            </Button>
          </FieldGroup>
        </form>
        <a href="/account/security">Account security</a>
      </AuthCard>
    </div>
  );
}
