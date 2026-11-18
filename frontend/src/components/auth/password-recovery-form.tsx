'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PasswordResetInputSchema,
  PasswordResetRequestInputSchema,
  type PasswordResetInput,
  type PasswordResetRequestInput,
} from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { AuthCard } from './auth-card';
import { FormInput, authFailure } from './form-input';
import { FieldGroup } from '../ui/field';
import { ArrowLeft } from 'lucide-react';
import { AuthAlert, AuthLink, authButtonClass } from './auth-parts';
import { buttonVariants } from '../ui/button';
import { cn } from 'cn';
import { PendingButton } from '../forms/pending-button';
import { toast } from 'sonner';
import { useSubmissionLock } from '../forms/use-submission-lock';
export function PasswordRecoveryForm({
  mode,
  token,
}: {
  mode: 'request' | 'reset';
  token?: string | undefined;
}) {
  return mode === 'request' ? (
    <RequestReset />
  ) : (
    <ResetPassword token={token} />
  );
}
function RequestReset() {
  const submission = useSubmissionLock();
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const form = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestInputSchema),
    defaultValues: { email: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const sent = !!message;
  return (
    <AuthCard
      presentation="page"
      title={sent ? 'Check your email' : 'Reset your password'}
      description={
        sent ? (
          <>
            If an account exists for <b>{form.getValues('email')}</b>, we sent a
            link to reset your password. The link expires in 30 minutes.
          </>
        ) : (
          'Enter the email you use for Lexon and we will send you a link to reset your password.'
        )
      }
    >
      <form
        noValidate
        method="post"
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
            setFailure('');
            try {
              const result = await authClient.requestPasswordReset({
                ...input,
                redirectTo: window.location.origin + '/reset-password',
              });
              if (
                result.error?.status === 503 ||
                result.error?.status === 429
              ) {
                setFailure(authFailure(result.error));
                return;
              }
              setMessage(
                'If eligible, you will receive a password reset link.',
              );
              toast.success(
                'If eligible, you will receive a password reset link.',
              );
            } catch {
              setFailure(authFailure({ status: 503 }));
            }
          }),
        )}
      >
        <FieldGroup>
          {failure ? (
            <AuthAlert title="Unable to request a reset link">
              {failure}
            </AuthAlert>
          ) : null}
          {sent ? (
            <p role="status" className="sr-only">
              {message}
            </p>
          ) : (
            <FormInput
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@firm.co.id"
              registration={form.register('email')}
              error={form.formState.errors.email}
            />
          )}
          <PendingButton
            type="submit"
            pending={submission.pending}
            pendingLabel="Sending reset link…"
            size="lg"
            variant={sent ? 'outline' : 'default'}
            className={authButtonClass}
          >
            {sent ? 'Resend link' : 'Send reset link'}
          </PendingButton>
          <BackToSignIn />
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
function BackToSignIn() {
  return (
    <AuthLink href="/sign-in" icon={<ArrowLeft aria-hidden="true" />}>
      Back to sign in
    </AuthLink>
  );
}
function ResetPassword({ token }: { token?: string | undefined }) {
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<PasswordResetInput>({
    resolver: zodResolver(PasswordResetInputSchema),
    defaultValues: { token: token ?? '', newPassword: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  useEffect(() => {
    window.history.replaceState(null, '', '/reset-password');
  }, []);
  const unavailable = !token && !done;
  return (
    <AuthCard
      presentation="page"
      title={unavailable ? 'This link has expired' : 'Choose a new password'}
      description={
        unavailable
          ? 'Reset links work once and expire after 30 minutes. Request a new link to continue.'
          : done
            ? undefined
            : 'Use at least 12 characters. You will be signed out on your other devices.'
      }
    >
      {token && !done ? (
        <form
          noValidate
          method="post"
          onSubmit={form.handleSubmit((input) =>
            submission.run(async () => {
              setFailure('');
              try {
                const result = await authClient.resetPassword(input);
                if (result.error) {
                  setFailure(authFailure(result.error));
                  return;
                }
                form.reset();
                setDone(true);
              } catch {
                setFailure(authFailure({ status: 503 }));
              }
            }),
          )}
        >
          <FieldGroup>
            {failure ? (
              <AuthAlert title="Unable to reset your password">
                {failure}
              </AuthAlert>
            ) : null}
            <FormInput
              label="New password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              registration={form.register('newPassword')}
              error={form.formState.errors.newPassword}
            />
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Resetting password…"
              size="lg"
              className={authButtonClass}
            >
              Update password
            </PendingButton>
            <BackToSignIn />
          </FieldGroup>
        </form>
      ) : (
        <>
          {done ? (
            <p role="status" className="text-[15px] leading-[1.55]">
              Password reset. Sign in with your new password.
            </p>
          ) : null}
          {done ? null : (
            <a
              href="/forgot-password"
              className={cn(buttonVariants({ size: 'lg' }), authButtonClass)}
            >
              Request a new link
            </a>
          )}
          <BackToSignIn />
        </>
      )}
    </AuthCard>
  );
}
