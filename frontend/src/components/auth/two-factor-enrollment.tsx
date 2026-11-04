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
import { FieldGroup } from '../ui/field';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { AuthenticationCodeForm } from './authentication-code-form';
import { RecoveryCodes } from './recovery-codes';
export function TwoFactorEnrollment({
  onComplete,
  presentation = 'card',
  headingLevel = 1,
}: {
  onComplete: () => Promise<void>;
  presentation?: 'card' | 'page';
  headingLevel?: 1 | 2 | 3;
}) {
  const [setup, setSetup] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<ReauthenticateInput>({
    resolver: zodResolver(ReauthenticateInputSchema),
    defaultValues: { password: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  if (codes)
    return (
      <RecoveryCodes
        codes={codes}
        headingLevel={headingLevel}
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
        presentation={presentation}
        title="Connect your authenticator"
        headingLevel={headingLevel}
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
      presentation={presentation}
      title="Two-factor authentication"
      headingLevel={headingLevel}
      description="Protect your account with an authenticator app."
    >
      <form
        noValidate
        method="post"
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
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
          }),
        )}
      >
        <FieldGroup>
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Unable to start enrollment</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <FormInput
            label="Enrollment password"
            type="password"
            autoComplete="current-password"
            registration={form.register('password')}
            error={form.formState.errors.password}
          />
          <PendingButton
            type="submit"
            pending={submission.pending}
            pendingLabel="Setting up authenticator…"
          >
            Set up authenticator
          </PendingButton>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
