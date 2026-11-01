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
import { Button } from '../ui/button';
import { FieldGroup, FieldError } from '../ui/field';
export function VerificationState({
  state,
  email = '',
  returnTo,
}: {
  state: 'pending' | 'confirmed' | 'expired';
  email?: string | undefined;
  returnTo?: string | undefined;
}) {
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const next = safeReturnPath(returnTo);
  const form = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestInputSchema),
    defaultValues: { email },
  });
  return (
    <AuthCard
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
          onSubmit={form.handleSubmit(async (input) => {
            setFailure('');
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
              setMessage('If eligible, you will receive a verification link.');
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
              Resend verification email
            </Button>
          </FieldGroup>
        </form>
      ) : null}
      <a href={'/sign-in?returnTo=' + encodeURIComponent(next)}>Sign in</a>
    </AuthCard>
  );
}
