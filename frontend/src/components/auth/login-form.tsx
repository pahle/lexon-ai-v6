'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignInInputSchema, type SignInInput } from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { AuthCard } from './auth-card';
import { FormInput, authFailure } from './form-input';
import { Button } from '../ui/button';
import { FieldGroup, FieldError } from '../ui/field';
export function LoginForm({ returnTo }: { returnTo?: string | undefined }) {
  const [failure, setFailure] = useState('');
  const form = useForm<SignInInput>({
    resolver: zodResolver(SignInInputSchema),
    defaultValues: { email: '', password: '' },
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
  return (
    <AuthCard
      title="Sign in"
      description="Enter your email and password to continue."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
          setFailure('');
          try {
            const result = await authClient.signIn.email(input);
            if (result.error) {
              setFailure(authFailure(result.error));
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
          <FormInput
            label="Password"
            type="password"
            autoComplete="current-password"
            registration={form.register('password')}
            error={form.formState.errors.password}
          />
          <a href="/forgot-password">Forgot your password?</a>
          {failure ? <FieldError>{failure}</FieldError> : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Sign in
          </Button>
          <a href={signup}>Create account</a>
          <a href={'/verify-email?returnTo=' + encodeURIComponent(next)}>
            Resend verification email
          </a>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
