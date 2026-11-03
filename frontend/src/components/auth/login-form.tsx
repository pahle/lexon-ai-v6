'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignInInputSchema, type SignInInput } from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { useVisualAuthFormReady } from './visual-readiness';
import { FormInput, authFailure } from './form-input';
import { Button } from '../ui/button';
import { Field, FieldGroup, FieldDescription, FieldError } from '../ui/field';
export function LoginForm({
  returnTo,
  visualClientReady = false,
}: {
  returnTo?: string | undefined;
  visualClientReady?: boolean | undefined;
}) {
  useVisualAuthFormReady(visualClientReady);
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
    <form
      className="flex flex-col gap-6"
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
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="font-serif text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Enter your email and password to continue.
          </p>
        </div>
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
        {failure ? <FieldError>{failure}</FieldError> : null}
        <Field>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Sign in
          </Button>
        </Field>
        <Field>
          <FieldDescription className="text-center">
            New to Lexon? <a href={signup}>Create account</a>
          </FieldDescription>
          <FieldDescription className="text-center">
            <a href={'/verify-email?returnTo=' + encodeURIComponent(next)}>
              Resend verification email
            </a>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
