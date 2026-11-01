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
import { FieldError } from '../ui/field';
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
        title="Administrator setup complete"
        description="Your verified account is now a platform administrator."
      >
        <a href="/platform/provisioning">Provisioning</a>
        <a href="/workspace">Return to workspace</a>
      </AuthCard>
    );
  if (phase === 'unavailable')
    return (
      <AuthCard
        title="Setup link unavailable"
        description="Request a new setup link from an operator, or try again later."
      >
        <a href="/workspace">Return to workspace</a>
      </AuthCard>
    );
  if (phase === 'loading')
    return (
      <AuthCard title="Administrator setup">
        <p role="status">Checking setup link…</p>
      </AuthCard>
    );
  if (phase === 'authenticate') {
    if (signup)
      return <SignupForm setupToken={token} returnTo={continuation} />;
    return (
      <AuthCard
        title="Administrator setup"
        description="Sign in with the account named in the setup email, or create that account. Verify your email and enroll an authenticator before activation."
      >
        <a href={'/sign-in?returnTo=' + encodeURIComponent(continuation)}>
          Sign in
        </a>
        <Button onClick={() => setSignup(true)}>Create setup account</Button>
        <a href="/workspace">Return to workspace</a>
      </AuthCard>
    );
  }
  if (
    phase === 'challenge' ||
    (security?.twoFactorEnabled && !security.mfaVerified)
  )
    return (
      <AuthCard title="Verify administrator setup">
        <a href={'/two-factor?returnTo=' + encodeURIComponent(continuation)}>
          Verify your sign-in
        </a>
        <a href="/workspace">Return to workspace</a>
      </AuthCard>
    );
  if (!security?.twoFactorEnabled)
    return (
      <div className="flex w-full max-w-md flex-col gap-6">
        <TwoFactorEnrollment onComplete={refresh} />
        <a href="/workspace">Return to workspace</a>
      </div>
    );
  return (
    <AuthCard
      title="Activate administrator access"
      description="Activate only for the verified account named in the setup email. The account must have no team memberships."
    >
      {failure ? <FieldError>{failure}</FieldError> : null}
      <Button
        disabled={busy}
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
      </Button>
      <a href="/workspace">Return to workspace</a>
    </AuthCard>
  );
}
