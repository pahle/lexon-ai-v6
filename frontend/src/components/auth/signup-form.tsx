'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignUpInputSchema, type SignUpInput } from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { useVisualAuthFormReady } from './visual-readiness';
import { VerificationState } from './verification-state';
import { FormInput, authFailure } from './form-input';
import { Field, FieldGroup, FieldDescription } from '../ui/field';
import { AuthAlert, AuthHeader, authButtonClass } from './auth-parts';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
export function SignupForm({
  invitationId,
  setupToken,
  returnTo,
  visualClientReady = false,
}: {
  invitationId?: string | undefined;
  setupToken?: string | undefined;
  returnTo?: string | undefined;
  visualClientReady?: boolean | undefined;
}) {
  useVisualAuthFormReady(visualClientReady);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<SignUpInput>({
    resolver: zodResolver(SignUpInputSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      ...(invitationId ? { invitationId } : {}),
      ...(setupToken ? { setupToken } : {}),
    },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
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
    <form
      className="flex flex-col"
      noValidate
      method="post"
      onSubmit={form.handleSubmit((input) =>
        submission.run(async () => {
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
        }),
      )}
    >
      <FieldGroup>
        <AuthHeader
          title="Create your account"
          description="Your legal workspace starts here."
        />
        {failure ? (
          <AuthAlert title="Unable to create your account">{failure}</AuthAlert>
        ) : null}
        <FormInput
          label="Full name"
          autoComplete="name"
          placeholder="Ayu Wardani"
          registration={form.register('name')}
          error={form.formState.errors.name}
        />
        <FormInput
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@firm.co.id"
          registration={form.register('email')}
          error={form.formState.errors.email}
        />
        <FormInput
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          hint="Use at least 12 characters."
          registration={form.register('password')}
          error={form.formState.errors.password}
        />
        <Field>
          <PendingButton
            type="submit"
            pending={submission.pending}
            pendingLabel="Creating account…"
            size="lg"
            className={authButtonClass}
          >
            Create account
          </PendingButton>
        </Field>
        <Field>
          <FieldDescription className="text-center text-sm leading-[1.21] text-muted-foreground [&>a]:text-foreground">
            Already have an account?{' '}
            <a href={'/sign-in?returnTo=' + encodeURIComponent(next)}>
              Sign in
            </a>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
