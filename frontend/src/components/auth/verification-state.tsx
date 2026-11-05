'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PasswordResetRequestInputSchema,
  type PasswordResetRequestInput,
} from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { AuthCard } from './auth-card';
import { FormInput, authFailure } from './form-input';
import { FieldGroup } from '../ui/field';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { PendingButton } from '../forms/pending-button';
import { toast } from 'sonner';
import { useSubmissionLock } from '../forms/use-submission-lock';
export function VerificationState({
  state,
  email = '',
  returnTo,
}: {
  state: 'pending' | 'confirmed' | 'expired';
  email?: string | undefined;
  returnTo?: string | undefined;
}) {
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const submission = useSubmissionLock();
  const next = safeReturnPath(returnTo);
  const form = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestInputSchema),
    defaultValues: { email },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  return (
    <AuthCard
      presentation="page"
      title={
        state === 'confirmed'
          ? 'Email verified'
          : state === 'expired'
            ? 'Unable to verify email'
            : 'Check your email'
      }
      description={
        state === 'confirmed'
          ? 'Sign in to continue.'
          : 'If eligible, you will receive a verification link. Check your inbox.'
      }
    >
      {state !== 'confirmed' ? (
        <form
          noValidate
          method="post"
          onSubmit={form.handleSubmit((input) =>
            submission.run(async () => {
              setFailure('');
              setMessage('');
              try {
                const result = await authClient.sendVerificationEmail({
                  ...input,
                  callbackURL:
                    window.location.origin +
                    '/verify-email?state=confirmed&returnTo=' +
                    encodeURIComponent(next),
                });
                if (
                  result.error?.status === 503 ||
                  result.error?.status === 429
                ) {
                  setFailure(authFailure(result.error));
                  return;
                }
                setMessage(
                  'If eligible, you will receive a verification link.',
                );
                toast.success(
                  'If eligible, you will receive a verification link.',
                );
              } catch {
                setFailure(authFailure({ status: 503 }));
              }
            }),
          )}
        >
          <FieldGroup>
            {failure ? (
              <Alert role="alert" variant="destructive">
                <AlertTitle>Unable to resend the verification email</AlertTitle>
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
            {message ? <p role="status">{message}</p> : null}
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Sending verification email…"
            >
              Resend verification email
            </PendingButton>
          </FieldGroup>
        </form>
      ) : null}
      <a href={'/sign-in?returnTo=' + encodeURIComponent(next)}>Sign in</a>
    </AuthCard>
  );
}
