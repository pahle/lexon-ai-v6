'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UuidSchema } from '@lexon/contracts';
import {
  createIdentityClient,
  IdentityClientError,
} from '../../lib/identity-client';
import { transitionTenant } from '../../lib/tenant-queries';
import { AuthCard } from './auth-card';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const query = useQueryClient();
  const valid = UuidSchema.safeParse(invitationId).success;
  const next =
    '/accept-invitation?invitationId=' + encodeURIComponent(invitationId);
  return (
    <AuthCard
      title="Accept invitation"
      description="Sign in with the invited account to accept this invitation."
    >
      {valid ? (
        <>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailure('');
              try {
                const result = await createIdentityClient({
                  baseUrl: '/api',
                }).acceptInvitation(invitationId);
                if (result.selection.status === 'switched') {
                  await transitionTenant(query, result.selection.organization);
                  window.history.replaceState(null, '', '/accept-invitation');
                  window.location.assign('/workspace');
                } else
                  window.location.assign(
                    '/workspace/security?pendingOrganizationId=' +
                      result.selection.pendingOrganizationId,
                  );
              } catch (error) {
                setFailure(
                  error instanceof IdentityClientError && error.status === 503
                    ? 'Service temporarily unavailable. Please try again.'
                    : 'This invitation is unavailable for this account. Sign in with the invited account or request a new invitation.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Accept invitation
          </Button>
          <a href={'/sign-in?returnTo=' + encodeURIComponent(next)}>Sign in</a>
          <a
            href={
              '/sign-up?invitationId=' +
              encodeURIComponent(invitationId) +
              '&returnTo=' +
              encodeURIComponent(next)
            }
          >
            Create account
          </a>
        </>
      ) : (
        <p>This invitation is unavailable. Request a new invitation.</p>
      )}
      {failure ? <FieldError>{failure}</FieldError> : null}
    </AuthCard>
  );
}
