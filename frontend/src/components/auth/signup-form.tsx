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
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
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
      className="flex flex-col gap-6"
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
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="font-serif text-2xl font-bold">Create your account</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Your legal workspace starts here.
          </p>
        </div>
        {failure ? (
          <Alert role="alert" variant="destructive">
            <AlertTitle>Unable to create your account</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
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
        <Field>
          <PendingButton
            type="submit"
            pending={submission.pending}
            pendingLabel="Creating account…"
          >
            Create account
          </PendingButton>
        </Field>
        <Field>
          <FieldDescription className="text-center">
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
