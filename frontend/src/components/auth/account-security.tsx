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
import { FieldGroup, FieldError } from '../ui/field';
import { Button } from '../ui/button';
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
  if (!security.data) return <p role="status">Loading account security…</p>;
  return (
    <div className="flex flex-col gap-6">
      <a href="/workspace">Return to workspace</a>
      {security.data.twoFactorEnabled && !security.data.mfaVerified ? (
        <a href="/two-factor?returnTo=%2Faccount%2Fsecurity">
          Verify your sign-in
        </a>
      ) : null}
      <Reauthentication onComplete={refresh} />
      {security.data.twoFactorEnabled ? (
        <FactorActions onComplete={refresh} />
      ) : (
        <TwoFactorEnrollment onComplete={refresh} />
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
  const [message, setMessage] = useState('');
  const form = useForm<ReauthenticateInput>({
    resolver: zodResolver(ReauthenticateInputSchema),
    defaultValues: { password: '', totp: '', recoveryCode: '' },
  });
  return (
    <AuthCard
      title="Confirm your identity"
      description="Confirm your password and, when enabled, one authentication code before security changes."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
          setMessage('');
          try {
            await api.reauthenticate({
              ...input,
              ...(!input.totp ? { totp: undefined } : {}),
              ...(!input.recoveryCode ? { recoveryCode: undefined } : {}),
            });
            form.reset();
            setMessage('Identity confirmed.');
            await onComplete();
          } catch {
            setMessage(
              'Unable to confirm your identity. Check your details and try again.',
            );
          }
        })}
      >
        <FieldGroup>
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
          <p role="status">{message}</p>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Confirm identity
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
function FactorActions({ onComplete }: { onComplete: () => Promise<void> }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState('');
  const form = useForm<ReauthenticateInput>({
    resolver: zodResolver(ReauthenticateInputSchema),
    defaultValues: { password: '' },
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
      description="Confirm your identity above before changing security settings."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
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
          }
        })}
      >
        <FieldGroup>
          <FormInput
            label="Security password"
            type="password"
            autoComplete="current-password"
            registration={form.register('password')}
            error={form.formState.errors.password}
          />
          {failure ? <FieldError>{failure}</FieldError> : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Generate new recovery codes
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={form.formState.isSubmitting}
            onClick={form.handleSubmit(async (input) => {
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
              }
            })}
          >
            Disable two-factor authentication
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
function PasswordChange({ onComplete }: { onComplete: () => Promise<void> }) {
  const [message, setMessage] = useState('');
  const form = useForm<PasswordChangeInput>({
    resolver: zodResolver(PasswordChangeInputSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  return (
    <AuthCard
      title="Change password"
      description="Confirm your identity first. Other sessions will be revoked."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
          try {
            const result = await authClient.changePassword(input);
            if (result.error) throw new Error();
            form.reset();
            setMessage('Password changed.');
            await onComplete();
          } catch {
            setMessage(
              'Unable to change your password. Confirm your identity and try again.',
            );
          }
        })}
      >
        <FieldGroup>
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
          <p role="status">{message}</p>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Change password
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
function EmailChange() {
  const [message, setMessage] = useState('');
  const form = useForm<EmailChangeInput>({
    resolver: zodResolver(EmailChangeInputSchema),
    defaultValues: { newEmail: '' },
  });
  return (
    <AuthCard
      title="Change email"
      description="Confirm your identity first. Verify your new address to complete the change."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (input) => {
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
            setMessage(
              'Unable to request this change. Confirm your identity and try again.',
            );
          }
        })}
      >
        <FieldGroup>
          <FormInput
            label="New email"
            type="email"
            autoComplete="email"
            registration={form.register('newEmail')}
            error={form.formState.errors.newEmail}
          />
          <p role="status">{message}</p>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Change email
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
