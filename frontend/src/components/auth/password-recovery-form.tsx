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
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
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
  return (
    <AuthCard
      presentation="page"
      title="Reset your password"
      description="Request a password reset link."
    >
      <form
        noValidate
        method="post"
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
            setFailure('');
            setMessage('');
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
            <Alert role="alert" variant="destructive">
              <AlertTitle>Unable to request a reset link</AlertTitle>
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
            pendingLabel="Sending reset link…"
          >
            Send reset link
          </PendingButton>
          <a href="/sign-in">Sign in</a>
        </FieldGroup>
      </form>
    </AuthCard>
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
  return (
    <AuthCard
      presentation="page"
      title="Choose a new password"
      description={
        !token
          ? 'Unable to use this reset link. Request a new link.'
          : undefined
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
              <Alert role="alert" variant="destructive">
                <AlertTitle>Unable to reset your password</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}
            <FormInput
              label="New password"
              type="password"
              autoComplete="new-password"
              registration={form.register('newPassword')}
              error={form.formState.errors.newPassword}
            />
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Resetting password…"
            >
              Reset password
            </PendingButton>
          </FieldGroup>
        </form>
      ) : (
        <p role="status">
          {done
            ? 'Password reset. Sign in with your new password.'
            : 'This link is unavailable.'}
        </p>
      )}
      <a href="/forgot-password">Request a new reset link</a>
      <a href="/sign-in">Sign in</a>
    </AuthCard>
  );
}
