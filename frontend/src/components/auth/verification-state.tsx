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
import { ArrowLeft } from 'lucide-react';
import { AuthAlert, AuthLink, authButtonClass } from './auth-parts';
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
            : 'Verify your email'
      }
      description={
        state === 'confirmed' ? (
          'Sign in to continue.'
        ) : email ? (
          <>
            We sent a verification link to <b>{email}</b>. Open it to activate
            your account.
          </>
        ) : (
          'If eligible, you will receive a verification link. Check your inbox.'
        )
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
              <AuthAlert title="Unable to resend the verification email">
                {failure}
              </AuthAlert>
            ) : null}
            {email ? null : (
              <FormInput
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@firm.co.id"
                registration={form.register('email')}
                error={form.formState.errors.email}
              />
            )}
            {message ? <p role="status">{message}</p> : null}
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Sending verification email…"
              size="lg"
              variant="outline"
              className={authButtonClass}
            >
              Resend email
            </PendingButton>
          </FieldGroup>
        </form>
      ) : null}
      {state === 'pending' && email ? (
        <p className="text-center text-sm text-muted-foreground">
          Wrong email?{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href={'/sign-up?returnTo=' + encodeURIComponent(next)}
          >
            Create the account again
          </a>
        </p>
      ) : null}
      <AuthLink
        href={'/sign-in?returnTo=' + encodeURIComponent(next)}
        icon={<ArrowLeft aria-hidden="true" />}
      >
        {state === 'confirmed' ? 'Sign in' : 'Back to sign in'}
      </AuthLink>
    </AuthCard>
  );
}
