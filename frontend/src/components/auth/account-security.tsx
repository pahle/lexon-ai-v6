'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PasswordChangeInputSchema,
  EmailChangeInputSchema,
  ReauthenticateInputSchema,
  type PasswordChangeInput,
  type EmailChangeInput,
  type ReauthenticateInput,
} from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import {
  createIdentityClient,
  IdentityClientError,
} from '../../lib/identity-client';
import { AuthCard } from './auth-card';
import { SessionBoundary } from './session-boundary';
import { TwoFactorEnrollment } from './two-factor-enrollment';
import { SessionList } from './session-list';
import { RecoveryCodes } from './recovery-codes';
import { FormInput } from './form-input';
import { FieldGroup } from '../ui/field';
import { PendingButton } from '../forms/pending-button';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { toast } from 'sonner';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { LoadingState } from '../states/page-states';
const api = createIdentityClient({ baseUrl: '/api' });
export function AccountSecurity() {
  const query = useQueryClient();
  const security = useQuery({
    queryKey: ['account', 'security'],
    queryFn: () => api.security(),
    retry: false,
  });
  const sessions = useQuery({
    queryKey: ['account', 'sessions'],
    queryFn: () => api.listSessions(),
    retry: false,
    enabled:
      !!security.data?.mfaVerified || security.data?.twoFactorEnabled === false,
  });
  const error = security.error ?? sessions.error;
  if (error)
    return (
      <SessionBoundary
        embedded
        state={
          error instanceof IdentityClientError && error.status === 401
            ? 'expired'
            : 'unavailable'
        }
      >
        {null}
      </SessionBoundary>
    );
  const refresh = async () => {
    await query.invalidateQueries({ queryKey: ['account'] });
  };
  if (!security.data)
    return <LoadingState message="Loading account security…" />;
  return (
    <div className="flex flex-col gap-6">
      <a href="/workspace">Return to workspace</a>
      {security.data.twoFactorEnabled && !security.data.mfaVerified ? (
        <a href="/two-factor?returnTo=%2Fsettings%2Fsecurity">
          Verify your sign-in
        </a>
      ) : null}
      <Reauthentication onComplete={refresh} />
      {security.data.twoFactorEnabled ? (
        <FactorActions onComplete={refresh} />
      ) : (
        <TwoFactorEnrollment onComplete={refresh} headingLevel={2} />
      )}
      <PasswordChange onComplete={refresh} />
      <EmailChange />
      {sessions.data ? (
        <SessionList
          sessions={sessions.data}
          onRevoke={async (id) => {
            await api.revokeSession(id);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
function Reauthentication({ onComplete }: { onComplete: () => Promise<void> }) {
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<ReauthenticateInput>({
    resolver: zodResolver(ReauthenticateInputSchema),
    defaultValues: { password: '', totp: '', recoveryCode: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  return (
    <AuthCard
      title="Confirm your identity"
      headingLevel={2}
      description="Confirm your password and, when enabled, one authentication code before security changes."
    >
      <form
        noValidate
        method="post"
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
            setFailure('');
            try {
              await api.reauthenticate({
                ...input,
                ...(!input.totp ? { totp: undefined } : {}),
                ...(!input.recoveryCode ? { recoveryCode: undefined } : {}),
              });
              form.reset();
              toast.success('Identity confirmed.');
              await onComplete();
            } catch {
              setFailure(
                'Unable to confirm your identity. Check your details and try again.',
              );
            }
          }),
        )}
      >
        <FieldGroup>
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Unable to confirm your identity</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <FormInput
            label="Current password"
            type="password"
            autoComplete="current-password"
            registration={form.register('password')}
            error={form.formState.errors.password}
          />
          <FormInput
            label="Authenticator code (if enabled)"
            registration={form.register('totp', {
              setValueAs: (value) => value || undefined,
            })}
            error={form.formState.errors.totp}
          />
          <FormInput
            label="Recovery code (alternative)"
            registration={form.register('recoveryCode', {
              setValueAs: (value) => value || undefined,
            })}
            error={form.formState.errors.recoveryCode}
          />
          <PendingButton
            type="submit"
            pending={submission.pending}
            pendingLabel="Confirming identity…"
          >
            Confirm identity
          </PendingButton>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
function FactorActions({ onComplete }: { onComplete: () => Promise<void> }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState('');
  const [operation, setOperation] = useState<'generate' | 'disable' | null>(
    null,
  );
  const submission = useSubmissionLock();
  const form = useForm<ReauthenticateInput>({
    resolver: zodResolver(ReauthenticateInputSchema),
    defaultValues: { password: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  useEffect(
    () => () => {
      form.reset();
    },
    [form],
  );
  if (codes)
    return <RecoveryCodes codes={codes} onDismiss={() => setCodes(null)} />;
  return (
    <AuthCard
      title="Manage authenticator"
      headingLevel={2}
      description="Confirm your identity above before changing security settings."
    >
      <form
        noValidate
        method="post"
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
            setOperation('generate');
            setFailure('');
            try {
              const result = await authClient.twoFactor.generateBackupCodes({
                password: input.password,
              });
              if (result.error) throw new Error();
              setCodes(result.data.backupCodes);
              form.reset();
            } catch {
              setFailure(
                'Unable to generate recovery codes. Confirm your identity and try again.',
              );
            } finally {
              setOperation(null);
            }
          }),
        )}
      >
        <FieldGroup>
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>
                Unable to update two-factor authentication
              </AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <FormInput
            label="Security password"
            type="password"
            autoComplete="current-password"
            registration={form.register('password')}
            error={form.formState.errors.password}
          />
          <PendingButton
            type="submit"
            pending={operation === 'generate' && submission.pending}
            disabled={submission.pending}
            pendingLabel="Generating recovery codes…"
          >
            Generate new recovery codes
          </PendingButton>
          <PendingButton
            type="button"
            variant="outline"
            pending={operation === 'disable' && submission.pending}
            disabled={submission.pending}
            pendingLabel="Disabling two-factor authentication…"
            onClick={form.handleSubmit((input) =>
              submission.run(async () => {
                setOperation('disable');
                try {
                  const result = await authClient.twoFactor.disable({
                    password: input.password,
                  });
                  if (result.error) throw new Error();
                  form.reset();
                  await onComplete();
                } catch {
                  setFailure(
                    'Unable to disable authentication. Confirm your identity and try again.',
                  );
                } finally {
                  setOperation(null);
                }
              }),
            )}
          >
            Disable two-factor authentication
          </PendingButton>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
function PasswordChange({ onComplete }: { onComplete: () => Promise<void> }) {
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<PasswordChangeInput>({
    resolver: zodResolver(PasswordChangeInputSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  return (
    <AuthCard
      title="Change password"
      headingLevel={2}
      description="Confirm your identity first. Other sessions will be revoked."
    >
      <form
        noValidate
        method="post"
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
            setFailure('');
            try {
              const result = await authClient.changePassword(input);
              if (result.error) throw new Error();
              form.reset();
              toast.success('Password changed.');
              await onComplete();
            } catch {
              setFailure(
                'Unable to change your password. Confirm your identity and try again.',
              );
            }
          }),
        )}
      >
        <FieldGroup>
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Unable to change your password</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <FormInput
            label="Password to change"
            type="password"
            autoComplete="current-password"
            registration={form.register('currentPassword')}
            error={form.formState.errors.currentPassword}
          />
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
            pendingLabel="Changing password…"
          >
            Change password
          </PendingButton>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
function EmailChange() {
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<EmailChangeInput>({
    resolver: zodResolver(EmailChangeInputSchema),
    defaultValues: { newEmail: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  return (
    <AuthCard
      title="Change email"
      headingLevel={2}
      description="Confirm your identity first. Verify your new address to complete the change."
    >
      <form
        noValidate
        method="post"
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
            setFailure('');
            setMessage('');
            try {
              const result = await authClient.changeEmail({
                ...input,
                callbackURL:
                  window.location.origin + '/verify-email?state=confirmed',
              });
              if (result.error) throw new Error();
              form.reset();
              setMessage('If eligible, you will receive a verification link.');
            } catch {
              setFailure(
                'Unable to request this change. Confirm your identity and try again.',
              );
            }
          }),
        )}
      >
        <FieldGroup>
          {failure ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Unable to request this email change</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <FormInput
            label="New email"
            type="email"
            autoComplete="email"
            registration={form.register('newEmail')}
            error={form.formState.errors.newEmail}
          />
          <p role="status">{message}</p>
          <PendingButton
            type="submit"
            pending={submission.pending}
            pendingLabel="Changing email…"
          >
            Change email
          </PendingButton>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
