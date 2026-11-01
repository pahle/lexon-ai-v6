'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ReauthenticateInputSchema,
  type ReauthenticateInput,
} from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { createIdentityClient } from '../../lib/identity-client';
import { AuthCard } from './auth-card';
import { FormInput, authFailure } from './form-input';
import { FieldGroup, FieldError } from '../ui/field';
import { Button } from '../ui/button';
import { AuthenticationCodeForm } from './authentication-code-form';
import { RecoveryCodes } from './recovery-codes';
export function TwoFactorEnrollment({
  onComplete,
}: {
  onComplete: () => Promise<void>;
}) {
  const [setup, setSetup] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState('');
  const form = useForm<ReauthenticateInput>({
    resolver: zodResolver(ReauthenticateInputSchema),
    defaultValues: { password: '' },
  });
  if (codes)
    return (
      <RecoveryCodes
        codes={codes}
        onDismiss={() => {
          setCodes(null);
          void onComplete();
        }}
      />
    );
  if (setup) {
    const uri = new URL(setup.totpURI);
    return (
      <AuthCard
        title="Connect your authenticator"
        description="Add this account manually in your authenticator app, then enter its six-digit code."
      >
        <dl>
          <dt>Issuer</dt>
          <dd>{uri.searchParams.get('issuer') ?? 'Lexon'}</dd>
          <dt>Account</dt>
          <dd>{decodeURIComponent(uri.pathname.slice(1))}</dd>
          <dt>Setup key</dt>
          <dd>
            <code>{uri.searchParams.get('secret')}</code>
          </dd>
        </dl>
        <details>
          <summary>Authenticator setup URI</summary>
          <code data-testid="authenticator-uri">{setup.totpURI}</code>
        </details>
        <AuthenticationCodeForm
          onSubmit={async (input) => {
            const result = await authClient.twoFactor.verifyTotp(input);
            if (result.error) throw new Error('Verification failed');
            setCodes(setup.backupCodes);
            setSetup(null);
          }}
        />
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Two-factor authentication"
      description="Protect your account with an authenticator app."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
          setFailure('');
          try {
            await createIdentityClient({ baseUrl: '/api' }).reauthenticate(
              input,
            );
            const result = await authClient.twoFactor.enable({
              password: input.password,
            });
            if (result.error || !result.data || !('totpURI' in result.data)) {
              setFailure(authFailure(result.error));
              return;
            }
            setSetup({
              totpURI: result.data.totpURI,
              backupCodes: result.data.backupCodes,
            });
            form.reset();
          } catch {
            setFailure(
              'Unable to start enrollment. Reauthenticate and try again.',
            );
          }
        })}
      >
        <FieldGroup>
          <FormInput
            label="Enrollment password"
            type="password"
            autoComplete="current-password"
            registration={form.register('password')}
            error={form.formState.errors.password}
          />
          {failure ? <FieldError>{failure}</FieldError> : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Set up authenticator
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
