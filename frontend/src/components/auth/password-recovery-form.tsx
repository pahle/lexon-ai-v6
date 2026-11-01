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
import { Button } from '../ui/button';
import { FieldGroup, FieldError } from '../ui/field';
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
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const form = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestInputSchema),
    defaultValues: { email: '' },
  });
  return (
    <AuthCard
      title="Reset your password"
      description="Request a password reset link."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
          setFailure('');
          try {
            const result = await authClient.requestPasswordReset({
              ...input,
              redirectTo: window.location.origin + '/reset-password',
            });
            if (result.error?.status === 503 || result.error?.status === 429) {
              setFailure(authFailure(result.error));
              return;
            }
            setMessage('If eligible, you will receive a password reset link.');
          } catch {
            setFailure(authFailure({ status: 503 }));
          }
        })}
      >
        <FieldGroup>
          <FormInput
            label="Email"
            type="email"
            autoComplete="email"
            registration={form.register('email')}
            error={form.formState.errors.email}
          />
          {failure ? <FieldError>{failure}</FieldError> : null}
          <p role="status">{message}</p>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Send reset link
          </Button>
          <a href="/sign-in">Sign in</a>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
function ResetPassword({ token }: { token?: string | undefined }) {
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState('');
  const form = useForm<PasswordResetInput>({
    resolver: zodResolver(PasswordResetInputSchema),
    defaultValues: { token: token ?? '', newPassword: '' },
  });
  useEffect(() => {
    window.history.replaceState(null, '', '/reset-password');
  }, []);
  return (
    <AuthCard
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
          onSubmit={form.handleSubmit(async (input) => {
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
          })}
        >
          <FieldGroup>
            <FormInput
              label="New password"
              type="password"
              autoComplete="new-password"
              registration={form.register('newPassword')}
              error={form.formState.errors.newPassword}
            />
            {failure ? <FieldError>{failure}</FieldError> : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Reset password
            </Button>
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
