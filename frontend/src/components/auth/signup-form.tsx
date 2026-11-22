'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  FlowTokenSchema,
  SignUpInputSchema,
  type SignUpInput,
} from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { safeReturnPath } from '../../lib/return-path';
import { useVisualAuthFormReady } from './visual-readiness';
import { VerificationState } from './verification-state';
import { FormInput, authFailure } from './form-input';
import { Field, FieldGroup, FieldDescription } from '../ui/field';
import { AuthAlert, AuthHeader, authButtonClass } from './auth-parts';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { InvitationUnavailable } from './invitation-unavailable';
export function SignupForm({
  invitationId,
  setupToken,
  accountInvitation,
  returnTo,
  visualClientReady = false,
}: {
  invitationId?: string | undefined;
  setupToken?: string | undefined;
  accountInvitation?: string | undefined;
  returnTo?: string | undefined;
  visualClientReady?: boolean | undefined;
}) {
  useVisualAuthFormReady(visualClientReady);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  // Account-invitation mode applies only without another sign-up proof (the
  // server ignores the token when one is present). A token the contract
  // rejects is shown as unavailable without a request.
  const invitationMode =
    accountInvitation !== undefined && !invitationId && !setupToken;
  const accountInvitationToken = invitationMode
    ? FlowTokenSchema.safeParse(accountInvitation).data
    : undefined;
  const [invitationRefused, setInvitationRefused] = useState(
    invitationMode && accountInvitationToken === undefined,
  );
  const submission = useSubmissionLock();
  const form = useForm<SignUpInput>({
    resolver: zodResolver(SignUpInputSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      ...(invitationId ? { invitationId } : {}),
      ...(setupToken ? { setupToken } : {}),
      ...(accountInvitationToken ? { accountInvitationToken } : {}),
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
  if (invitationRefused) return <InvitationUnavailable />;
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
              const refused = result.error as {
                status?: number;
                error?: { code?: unknown };
              };
              if (
                invitationMode &&
                refused.status === 401 &&
                refused.error?.code === 'AUTH_REQUIRED'
              ) {
                setInvitationRefused(true);
                return;
              }
              setFailure(authFailure(result.error));
              return;
            }
            // An invitation sign-up is verified on acceptance and sends no
            // verification email, so the account can sign in right away.
            if (invitationMode) {
              window.location.assign(
                '/sign-in?returnTo=' + encodeURIComponent(next),
              );
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
