'use client';
import { useState } from 'react';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { AuthenticationCodeForm } from './authentication-code-form';
import { AuthCard } from './auth-card';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { AuthLink, authLinkClass } from './auth-parts';
export function TwoFactorChallenge({
  returnTo,
}: {
  returnTo?: string | undefined;
}) {
  const [recovery, setRecovery] = useState(false);
  return (
    <AuthCard
      presentation="page"
      title="Two-step verification"
      description={
        recovery
          ? 'Enter one of your recovery codes to continue.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      <AuthenticationCodeForm
        key={String(recovery)}
        recovery={recovery}
        presentation="auth"
        submitLabel={recovery ? 'Verify recovery code' : 'Verify'}
        label="Authentication code"
        onSubmit={async (input) => {
          const result = recovery
            ? await authClient.twoFactor.verifyBackupCode(input)
            : await authClient.twoFactor.verifyTotp(input);
          if (result.error) throw new Error('Verification failed');
          window.location.assign(safeReturnPath(returnTo));
        }}
      />
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          className={authLinkClass}
          onClick={() => setRecovery((value) => !value)}
        >
          <KeyRound aria-hidden="true" />
          {recovery ? 'Use an authenticator code' : 'Use a recovery code'}
        </button>
        <AuthLink href="/sign-in" icon={<ArrowLeft aria-hidden="true" />}>
          Back to sign in
        </AuthLink>
      </div>
    </AuthCard>
  );
}
