'use client';
import { useState } from 'react';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { AuthenticationCodeForm } from './authentication-code-form';
import { AuthCard } from './auth-card';
import { Button } from '../ui/button';
export function TwoFactorChallenge({
  returnTo,
}: {
  returnTo?: string | undefined;
}) {
  const [recovery, setRecovery] = useState(false);
  return (
    <AuthCard
      title="Verify your sign-in"
      description="Use your authenticator app or a recovery code to continue."
    >
      <AuthenticationCodeForm
        key={String(recovery)}
        recovery={recovery}
        submitLabel={recovery ? 'Verify recovery code' : 'Verify authenticator'}
        onSubmit={async (input) => {
          const result = recovery
            ? await authClient.twoFactor.verifyBackupCode(input)
            : await authClient.twoFactor.verifyTotp(input);
          if (result.error) throw new Error('Verification failed');
          window.location.assign(safeReturnPath(returnTo));
        }}
      />
      <Button variant="link" onClick={() => setRecovery((value) => !value)}>
        {recovery ? 'Use an authenticator code' : 'Use a recovery code'}
      </Button>
    </AuthCard>
  );
}
