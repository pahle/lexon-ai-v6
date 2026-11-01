'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PasswordResetRequestInputSchema,
  type PasswordResetRequestInput,
} from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
} from '../organizations/page-state';
import { AuthCard } from '../auth/auth-card';
import { FormInput } from '../auth/form-input';
import { FieldGroup, FieldError } from '../ui/field';
import { Button } from '../ui/button';
export function ProvisioningDetail({
  organizationId,
}: {
  organizationId: string;
}) {
  const query = useQueryClient();
  const result = useQuery({
    queryKey: ['platform', 'provisioning', organizationId],
    queryFn: () => identityApi.getProvisioning(organizationId),
    retry: false,
  });
  const [failure, setFailure] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestInputSchema),
    defaultValues: { email: '' },
  });
  if (result.error) return <QueryFailure error={result.error} />;
  if (!result.data) return <p role="status">Loading provisioning metadata…</p>;
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure('');
    try {
      await action();
      await query.invalidateQueries({ queryKey: ['platform', 'provisioning'] });
    } catch (error) {
      setFailure(identityMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <a href="/platform/provisioning">Provisioning</a>
      <a href="/platform/accounts">Account status</a>
      <AuthCard
        title={result.data.name}
        description="Provisioning metadata and invitation status only."
      >
        <dl>
          <dt>State</dt>
          <dd>{result.data.state}</dd>
          <dt>Owner invitation</dt>
          <dd>{result.data.invitation.status}</dd>
          <dt>Expires</dt>
          <dd>
            {new Date(result.data.invitation.expiresAt).toLocaleString('en')}
          </dd>
        </dl>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void mutate(() => identityApi.resendOwnerInvitation(organizationId))
          }
        >
          Resend owner invitation
        </Button>
        <form
          noValidate
          onSubmit={form.handleSubmit((input) =>
            mutate(async () => {
              await identityApi.replaceOwnerEmail(organizationId, input);
              form.reset();
            }),
          )}
        >
          <FieldGroup>
            <FormInput
              label="Replacement owner email"
              type="email"
              registration={form.register('email')}
              error={form.formState.errors.email}
            />
            <Button type="submit" disabled={busy}>
              Replace owner email
            </Button>
          </FieldGroup>
        </form>
        {confirm ? (
          <>
            <p>
              Cancellation deletes this provisioning organization and
              invalidates its invitation.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                void mutate(async () => {
                  await identityApi.cancelProvisioning(organizationId);
                  window.location.assign('/platform/provisioning');
                })
              }
            >
              Confirm cancellation
            </Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Keep provisioning
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Cancel provisioning
          </Button>
        )}
        {failure ? <FieldError>{failure}</FieldError> : null}
        <a href="/account/security">Account security</a>
      </AuthCard>
    </div>
  );
}
