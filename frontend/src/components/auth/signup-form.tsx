'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignUpInputSchema, type SignUpInput } from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { AuthCard } from './auth-card';
import { VerificationState } from './verification-state';
import { FormInput, authFailure } from './form-input';
import { Button } from '../ui/button';
import { FieldGroup, FieldError } from '../ui/field';
export function SignupForm({
  invitationId,
  setupToken,
  returnTo,
}: {
  invitationId?: string | undefined;
  setupToken?: string | undefined;
  returnTo?: string | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const form = useForm<SignUpInput>({
    resolver: zodResolver(SignUpInputSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      ...(invitationId ? { invitationId } : {}),
      ...(setupToken ? { setupToken } : {}),
    },
  });
  const next = safeReturnPath(
    returnTo ??
      (invitationId
        ? '/accept-invitation?invitationId=' + encodeURIComponent(invitationId)
        : undefined),
  );
  if (pending)
    return (
      <VerificationState
        state="pending"
        email={form.getValues('email')}
        returnTo={next}
      />
    );
  return (
    <AuthCard
      title="Create your account"
      description="Create an account to use Lexon."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
          setFailure('');
          try {
            const result = await authClient.$fetch('/sign-up/email', {
              method: 'POST',
              body: {
                ...input,
                callbackURL:
                  window.location.origin +
                  '/verify-email?state=confirmed&returnTo=' +
                  encodeURIComponent(next),
              },
            });
            if (result.error) {
              setFailure(authFailure(result.error));
              return;
            }
            setPending(true);
          } catch {
            setFailure(authFailure({ status: 503 }));
          }
        })}
      >
        <FieldGroup>
          <FormInput
            label="Name"
            autoComplete="name"
            registration={form.register('name')}
            error={form.formState.errors.name}
          />
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
            autoComplete="new-password"
            registration={form.register('password')}
            error={form.formState.errors.password}
          />
          <p className="text-sm text-muted-foreground">
            Use at least 12 characters.
          </p>
          {failure ? <FieldError>{failure}</FieldError> : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Create account
          </Button>
          <a href={'/sign-in?returnTo=' + encodeURIComponent(next)}>Sign in</a>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
