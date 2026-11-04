'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignInInputSchema, type SignInInput } from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { useVisualAuthFormReady } from './visual-readiness';
import { VerificationState } from './verification-state';
import { FormInput, authFailure } from './form-input';
import { Field, FieldGroup, FieldDescription } from '../ui/field';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';

function requiresEmailVerification(error: unknown): boolean {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  const nested = (error as { error?: unknown }).error;
  return (
    !!nested &&
    typeof nested === 'object' &&
    !Array.isArray(nested) &&
    (nested as { code?: unknown }).code === 'EMAIL_NOT_VERIFIED'
  );
}

function signInFailure(error: { status?: number } | null | undefined) {
  if (error?.status === 503 || error?.status === 0 || error?.status === 429)
    return authFailure(error);
  return 'Email or password is incorrect. Check them and try again.';
}

export function LoginForm({
  returnTo,
  visualClientReady = false,
}: {
  returnTo?: string | undefined;
  visualClientReady?: boolean | undefined;
}) {
  useVisualAuthFormReady(visualClientReady);
  const [failure, setFailure] = useState('');
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    null,
  );
  const submission = useSubmissionLock();
  const form = useForm<SignInInput>({
    resolver: zodResolver(SignInInputSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const next = safeReturnPath(returnTo);
  const continuation = new URL(next, 'https://lexon.invalid');
  const invitationId =
    continuation.pathname === '/accept-invitation'
      ? continuation.searchParams.get('invitationId')
      : null;
  const signup =
    '/sign-up?returnTo=' +
    encodeURIComponent(next) +
    (invitationId ? '&invitationId=' + encodeURIComponent(invitationId) : '');
  if (verificationEmail)
    return (
      <VerificationState
        state="pending"
        email={verificationEmail}
        returnTo={next}
      />
    );
  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      method="post"
      onSubmit={form.handleSubmit((input) =>
        submission.run(async () => {
          setFailure('');
          try {
            const result = await authClient.signIn.email(input);
            if (result.error) {
              if (requiresEmailVerification(result.error)) {
                setVerificationEmail(input.email);
                return;
              }
              setFailure(signInFailure(result.error));
              return;
            }
            const data = result.data as { twoFactorRedirect?: boolean } | null;
            window.location.assign(
              data?.twoFactorRedirect
                ? '/two-factor?returnTo=' + encodeURIComponent(next)
                : next,
            );
          } catch {
            setFailure(authFailure({ status: 503 }));
          }
        }),
      )}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="font-serif text-2xl font-bold">Sign in to Lexon</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Enter your email and password to continue.
          </p>
        </div>
        {failure ? (
          <Alert role="alert" variant="destructive">
            <AlertTitle>Unable to sign in</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        <FormInput
          label="Email"
          type="email"
          autoComplete="email"
          registration={form.register('email')}
          error={form.formState.errors.email}
        />
        <FormInput
          label="Password"
          labelAside={
            <a
              href="/forgot-password"
              className="ml-auto text-sm underline-offset-4 hover:underline"
            >
              Forgot your password?
            </a>
          }
          type="password"
          autoComplete="current-password"
          registration={form.register('password')}
          error={form.formState.errors.password}
        />
        <Field>
          <PendingButton
            type="submit"
            pending={submission.pending}
            pendingLabel="Signing in…"
          >
            Sign in
          </PendingButton>
        </Field>
        <Field>
          <FieldDescription className="text-center">
            New to Lexon? <a href={signup}>Create account</a>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
