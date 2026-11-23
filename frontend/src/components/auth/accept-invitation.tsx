'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UuidSchema } from '@lexon/contracts';
import {
  createIdentityClient,
  IdentityClientError,
} from '../../lib/identity-client';
import { transitionTenant } from '../../lib/tenant-queries';
import { authClient } from '../../lib/auth-client';
import { AuthCard } from './auth-card';
import { cn } from 'cn';
import { buttonVariants } from '../ui/button';
import { AuthAlert, authButtonClass } from './auth-parts';
import { PendingButton } from '../forms/pending-button';
import { InvitationUnavailable } from './invitation-unavailable';
export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const [declined, setDeclined] = useState(false);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<
    'accept' | 'decline' | 'signout' | null
  >(null);
  const query = useQueryClient();
  const valid = UuidSchema.safeParse(invitationId).success;
  const next =
    '/accept-invitation?invitationId=' + encodeURIComponent(invitationId);
  if (declined)
    return (
      <AuthCard
        presentation="page"
        title="Invitation declined"
        description="You will not join this organization. Ask the person who invited you if you change your mind."
      >
        <a
          href="/workspace"
          className={cn(buttonVariants({ size: 'lg' }), authButtonClass)}
        >
          Go to my workspace
        </a>
      </AuthCard>
    );
  if (!valid) return <InvitationUnavailable />;
  return (
    <AuthCard
      presentation="page"
      title="Accept invitation"
      description="Join the organization that invited you. Use the account the invitation was sent to."
    >
      <>
        <PendingButton
          pending={busy && operation === 'accept'}
          disabled={busy && operation !== 'accept'}
          pendingLabel="Accepting invitation…"
          size="lg"
          className={authButtonClass}
          onClick={async () => {
            setBusy(true);
            setOperation('accept');
            setFailure('');
            try {
              const result = await createIdentityClient({
                baseUrl: '/api',
              }).acceptInvitation(invitationId);
              if (result.selection.status === 'switched') {
                await transitionTenant(query, result.selection.organization);
                window.history.replaceState(null, '', '/accept-invitation');
                window.location.assign('/workspace');
              } else window.location.assign('/workspace?settings=security');
            } catch (error) {
              setFailure(
                error instanceof IdentityClientError && error.status === 503
                  ? 'Service temporarily unavailable. Please try again.'
                  : 'This invitation is unavailable for this account. Sign in with the invited account or request a new invitation.',
              );
            } finally {
              setBusy(false);
              setOperation(null);
            }
          }}
        >
          Accept invitation
        </PendingButton>
        <PendingButton
          variant="outline"
          size="lg"
          className={authButtonClass}
          pending={busy && operation === 'decline'}
          disabled={busy && operation !== 'decline'}
          pendingLabel="Declining invitation…"
          onClick={async () => {
            setBusy(true);
            setOperation('decline');
            setFailure('');
            try {
              await createIdentityClient({
                baseUrl: '/api',
              }).declineInvitation(invitationId);
              window.history.replaceState(null, '', '/accept-invitation');
              setDeclined(true);
            } catch {
              setFailure('This invitation is unavailable for this account.');
            } finally {
              setBusy(false);
              setOperation(null);
            }
          }}
        >
          Decline invitation
        </PendingButton>
        <p className="text-center text-sm leading-[1.21] text-muted-foreground">
          Not the invited account?{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href={'/sign-in?returnTo=' + encodeURIComponent(next)}
          >
            Sign in
          </a>{' '}
          or{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href={
              '/sign-up?invitationId=' +
              encodeURIComponent(invitationId) +
              '&returnTo=' +
              encodeURIComponent(next)
            }
          >
            create an account
          </a>
          .
        </p>
      </>
      {failure ? (
        <>
          <AuthAlert title="Unable to update this invitation">
            {failure}
          </AuthAlert>
          <PendingButton
            variant="outline"
            size="lg"
            className={authButtonClass}
            pending={busy && operation === 'signout'}
            disabled={busy && operation !== 'signout'}
            pendingLabel="Switching accounts…"
            onClick={async () => {
              setBusy(true);
              setOperation('signout');
              try {
                const result = await authClient.signOut();
                if (result.error) throw new Error();
                await query.cancelQueries();
                query.clear();
                window.location.assign(
                  '/sign-in?returnTo=' + encodeURIComponent(next),
                );
              } catch {
                setFailure(
                  'Service temporarily unavailable. Please try again.',
                );
                setBusy(false);
                setOperation(null);
              }
            }}
          >
            Use another account
          </PendingButton>
        </>
      ) : null}
    </AuthCard>
  );
}
