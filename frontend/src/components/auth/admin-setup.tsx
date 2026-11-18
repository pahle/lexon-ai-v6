'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SecurityState } from '@lexon/contracts';
import {
  createIdentityClient,
  IdentityClientError,
} from '../../lib/identity-client';
import { setupCommand } from '../../lib/admin-setup-client';
import { authClient } from '../../lib/auth-client';
import { AuthCard } from './auth-card';
import { SignupForm } from './signup-form';
import { TwoFactorEnrollment } from './two-factor-enrollment';
import { Button } from '../ui/button';
import { cn } from 'cn';
import { buttonVariants } from '../ui/button';
import { ArrowLeft } from 'lucide-react';
import { AuthAlert, AuthLink, authButtonClass } from './auth-parts';
import { PendingButton } from '../forms/pending-button';
const api = createIdentityClient({ baseUrl: '/api' });
export function AdminSetup({ setupToken }: { setupToken: string }) {
  const query = useQueryClient();
  const [token, setToken] = useState(setupToken);
  const [phase, setPhase] = useState<
    'loading' | 'authenticate' | 'ready' | 'challenge' | 'unavailable' | 'done'
  >('loading');
  const [security, setSecurity] = useState<SecurityState | null>(null);
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const continuation = '/admin-setup?token=' + encodeURIComponent(token);
  async function refresh() {
    try {
      await setupCommand('redeem', token);
      const state = await api.security();
      setSecurity(state);
      await api.profile();
      setPhase('ready');
    } catch (error) {
      if (error instanceof IdentityClientError && error.status === 401) {
        const result = await authClient.signOut();
        setPhase(result.error ? 'unavailable' : 'authenticate');
      } else if (
        error instanceof IdentityClientError &&
        error.code === 'AUTH_2FA_REQUIRED'
      )
        setPhase('challenge');
      else setPhase('unavailable');
    }
  }
  useEffect(() => {
    window.history.replaceState(null, '', '/admin-setup');
    if (!token) {
      setPhase((previous) => (previous === 'done' ? 'done' : 'unavailable'));
      return;
    }
    void refresh().catch(() => setPhase('unavailable'));
  }, [token]);
  if (phase === 'done')
    return (
      <AuthCard
        presentation="page"
        title="Administrator setup complete"
        description="Your verified account is now a platform administrator."
      >
        <AuthLink href="/platform/provisioning">Provisioning</AuthLink>
        <AuthLink href="/workspace" icon={<ArrowLeft aria-hidden="true" />}>
          Return to workspace
        </AuthLink>
      </AuthCard>
    );
  if (phase === 'unavailable')
    return (
      <AuthCard
        presentation="page"
        title="Setup link unavailable"
        description="This setup link has expired or has already been used. Ask your operator for a new link."
      >
        <a
          href="/sign-in"
          className={cn(buttonVariants({ size: 'lg' }), authButtonClass)}
        >
          Go to sign in
        </a>
      </AuthCard>
    );
  if (phase === 'loading')
    return (
      <AuthCard presentation="page" title="Administrator setup">
        <p role="status">Checking setup link…</p>
      </AuthCard>
    );
  if (phase === 'authenticate') {
    if (signup)
      return <SignupForm setupToken={token} returnTo={continuation} />;
    return (
      <AuthCard
        presentation="page"
        title="Set up platform administration"
        description="Sign in with the account named in the setup email, or create that account. Verify your email and set up two-step verification before activation."
      >
        <a
          href={'/sign-in?returnTo=' + encodeURIComponent(continuation)}
          className={cn(buttonVariants({ size: 'lg' }), authButtonClass)}
        >
          Sign in
        </a>
        <Button
          size="lg"
          variant="outline"
          className={authButtonClass}
          onClick={() => setSignup(true)}
        >
          Create setup account
        </Button>
        <AuthLink href="/workspace" icon={<ArrowLeft aria-hidden="true" />}>
          Return to workspace
        </AuthLink>
      </AuthCard>
    );
  }
  if (
    phase === 'challenge' ||
    (security?.twoFactorEnabled && !security.mfaVerified)
  )
    return (
      <AuthCard presentation="page" title="Verify administrator setup">
        <AuthLink
          href={'/two-factor?returnTo=' + encodeURIComponent(continuation)}
        >
          Verify your sign-in
        </AuthLink>
        <AuthLink href="/workspace" icon={<ArrowLeft aria-hidden="true" />}>
          Return to workspace
        </AuthLink>
      </AuthCard>
    );
  if (!security?.twoFactorEnabled)
    return (
      <div className="flex w-full flex-col gap-6">
        <TwoFactorEnrollment onComplete={refresh} presentation="page" />
        <AuthLink href="/workspace" icon={<ArrowLeft aria-hidden="true" />}>
          Return to workspace
        </AuthLink>
      </div>
    );
  return (
    <AuthCard
      presentation="page"
      title="Activate administrator access"
      description="Activate only for the verified account named in the setup email. The account must have no team memberships."
    >
      {failure ? (
        <AuthAlert title="Unable to complete administrator setup">
          {failure}
        </AuthAlert>
      ) : null}
      <PendingButton
        pending={busy}
        pendingLabel="Activating administrator access…"
        size="lg"
        className={authButtonClass}
        onClick={async () => {
          setBusy(true);
          setFailure('');
          try {
            await setupCommand('complete', token);
            await query.cancelQueries();
            query.clear();
            setPhase('done');
            setToken('');
            window.history.replaceState(null, '', '/admin-setup');
          } catch {
            setFailure(
              'Unable to complete administrator setup. Check your account or request a new link.',
            );
            setBusy(false);
          }
        }}
      >
        Activate platform administrator
      </PendingButton>
      <AuthLink href="/workspace" icon={<ArrowLeft aria-hidden="true" />}>
        Return to workspace
      </AuthLink>
    </AuthCard>
  );
}
