'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  InvitationInputSchema,
  type InvitationInput,
  type OrganizationSummary,
} from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
  useCursorPage,
} from './page-state';
import { AuthCard } from '../auth/auth-card';
import { FormInput } from '../auth/form-input';
import { Button } from '../ui/button';
import { FieldError, FieldGroup } from '../ui/field';
export function Invitations({
  organization,
}: {
  organization: OrganizationSummary;
}) {
  const query = useQueryClient();
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<InvitationInput>({
    resolver: zodResolver(InvitationInputSchema),
    defaultValues: { email: '', role: 'member' },
  });
  const allowed =
    organization.kind === 'team' && organization.role !== 'member';
  const { query: invitations, pagination } = useCursorPage(
    ['tenant', organization.id, 'invitations'],
    (cursor) =>
      identityApi.listOrganizationInvitations(organization.id, {
        limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
    allowed,
  );
  if (!allowed)
    return <p>Invitation management is available to team owners and admins.</p>;
  if (invitations.error) return <QueryFailure error={invitations.error} />;
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure('');
    try {
      await action();
      await query.invalidateQueries({
        queryKey: ['tenant', organization.id, 'invitations'],
      });
    } catch (error) {
      setFailure(identityMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard
      title="Invitations"
      description="Invite members or manage pending invitations."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((input) =>
          mutate(async () => {
            await identityApi.createInvitation(organization.id, {
              ...input,
              role: 'member',
            });
            form.reset();
          }),
        )}
      >
        <FieldGroup>
          <FormInput
            label="Invitation email"
            type="email"
            registration={form.register('email')}
            error={form.formState.errors.email}
          />
          <Button type="submit" disabled={busy}>
            Invite member
          </Button>
          {organization.role === 'owner' ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={form.handleSubmit((input) =>
                mutate(async () => {
                  await identityApi.createInvitation(organization.id, {
                    ...input,
                    role: 'admin',
                  });
                  form.reset();
                }),
              )}
            >
              Invite admin
            </Button>
          ) : null}
        </FieldGroup>
      </form>
      <ul>
        {invitations.data?.items.map((invitation) => (
          <li key={invitation.id} className="flex flex-col gap-2 py-3">
            <span>{invitation.email}</span>
            <span>
              {invitation.role} — {invitation.status}
            </span>
            {invitation.status === 'pending' ||
            invitation.status === 'expired' ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      identityApi.resendInvitation(invitation.id),
                    )
                  }
                >
                  Resend invitation
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      identityApi.cancelInvitation(invitation.id),
                    )
                  }
                >
                  Cancel invitation
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {pagination}
      {failure ? <FieldError>{failure}</FieldError> : null}
    </AuthCard>
  );
}
