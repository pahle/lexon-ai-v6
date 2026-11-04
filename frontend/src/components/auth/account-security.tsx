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
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { useWorkspace } from '../shell/workspace-provider';
const api = createIdentityClient({ baseUrl: '/api' });
export function AccountSecurity() {
  const query = useQueryClient();
  const [activeAction, setActiveAction] = useState<
    | 'reauth'
    | 'two-factor'
    | 'recovery-codes'
    | 'manage-two-factor'
    | 'password'
    | 'email'
    | null
  >(null);
  const [confirmSignOutOthers, setConfirmSignOutOthers] = useState(false);
  const [signOutOthersBusy, setSignOutOthersBusy] = useState(false);
  const [signOutOthersFailure, setSignOutOthersFailure] = useState(false);
  const { identity } = useWorkspace();
  const security = useQuery({
    queryKey: ['account', 'security'],
    queryFn: () => api.security(),
    retry: false,
  });
  const sessionsEnabled =
    !!security.data?.mfaVerified || security.data?.twoFactorEnabled === false;
  const sessions = useQuery({
    queryKey: ['account', 'sessions'],
    queryFn: () => api.listSessions(),
    retry: false,
    enabled: sessionsEnabled,
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
  if (activeAction) {
    return (
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          className="w-fit"
          onClick={() => setActiveAction(null)}
        >
          Back to security
        </Button>
        {!['two-factor', 'recovery-codes', 'manage-two-factor'].includes(
          activeAction,
        ) ? (
          <Reauthentication onComplete={refresh} />
        ) : null}
        {activeAction === 'two-factor' ? (
          security.data.twoFactorEnabled ? (
            <FactorActions mode="manage" onComplete={refresh} />
          ) : (
            <TwoFactorEnrollment
              onComplete={refresh}
              headingLevel={2}
              showBrandFooter={false}
            />
          )
        ) : null}
        {activeAction === 'recovery-codes' ? (
          <FactorActions mode="recovery" onComplete={refresh} />
        ) : null}
        {activeAction === 'manage-two-factor' ? (
          <FactorActions mode="manage" onComplete={refresh} />
        ) : null}
        {activeAction === 'password' ? (
          <PasswordChange onComplete={refresh} />
        ) : null}
        {activeAction === 'email' ? <EmailChange /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="security-heading"
        className="flex flex-col gap-4"
      >
        <div>
          <h2 id="security-heading" className="text-lg font-medium">
            Security
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage sign-in methods and active sessions.
          </p>
        </div>
        <SecurityRow
          title="Password"
          description="Change the password you use to sign in."
          action="Change password"
          onAction={() => setActiveAction('password')}
        />
        <SecurityRow
          title="Email"
          description={identity?.user.email ?? 'Email address'}
          action="Change email"
          onAction={() => setActiveAction('email')}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Two-factor authentication</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge
                variant={
                  security.data.twoFactorEnabled ? 'secondary' : 'outline'
                }
              >
                {security.data.twoFactorEnabled ? 'On' : 'Off'}
              </Badge>
              {security.data.twoFactorEnabled ? (
                <span>
                  {security.data.recoveryCodesRemaining} recovery codes left
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {security.data.twoFactorEnabled ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setActiveAction('recovery-codes')}
                >
                  Recovery codes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setActiveAction('manage-two-factor')}
                >
                  Manage
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => setActiveAction('two-factor')}
              >
                Set up authenticator
              </Button>
            )}
          </div>
        </div>
      </section>
      {sessionsEnabled ? (
        <SessionList
          sessions={sessions.data ?? []}
          loading={sessions.isLoading}
          failure={signOutOthersFailure}
          onSignOutOthers={() => setConfirmSignOutOthers(true)}
          onRevoke={async (id) => {
            await api.revokeSession(id);
            await refresh();
            toast.success('Session revoked.');
          }}
        />
      ) : null}
      <AlertDialog
        open={confirmSignOutOthers}
        onOpenChange={(open) => setConfirmSignOutOthers(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out other sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              Other browsers and add-in sessions will lose access to your
              account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signOutOthersBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              render={
                <PendingButton
                  pending={signOutOthersBusy}
                  pendingLabel="Signing out other sessions…"
                >
                  Sign out other sessions
                </PendingButton>
              }
              disabled={signOutOthersBusy}
              onClick={async (event) => {
                event.preventDefault();
                setSignOutOthersBusy(true);
                setSignOutOthersFailure(false);
                try {
                  const result = await authClient.revokeOtherSessions();
                  if (result.error) throw new Error();
                  await refresh();
                  setConfirmSignOutOthers(false);
                  toast.success('Other sessions signed out.');
                } catch {
                  setSignOutOthersFailure(true);
                } finally {
                  setSignOutOthersBusy(false);
                }
              }}
            >
              Sign out other sessions
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {security.data.twoFactorEnabled && !security.data.mfaVerified ? (
        <a href="/two-factor?returnTo=%2Fworkspace%3Fsettings%3Dsecurity">
          Verify your sign-in
        </a>
      ) : null}
    </div>
  );
}

function SecurityRow({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" onClick={onAction}>
        {action}
      </Button>
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
      showBrandFooter={false}
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
function FactorActions({
  mode,
  onComplete,
}: {
  mode: 'recovery' | 'manage';
  onComplete: () => Promise<void>;
}) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState('');
  const [confirmDisable, setConfirmDisable] = useState(false);
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
    return (
      <RecoveryCodes
        codes={codes}
        onDismiss={() => setCodes(null)}
        showBrandFooter={false}
      />
    );
  return (
    <AuthCard
      title={mode === 'recovery' ? 'Recovery codes' : 'Manage authenticator'}
      headingLevel={2}
      showBrandFooter={false}
      description={
        mode === 'recovery'
          ? 'Generate a new set of recovery codes for your account.'
          : 'Confirm your password to turn off two-factor authentication.'
      }
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
          {mode === 'recovery' ? (
            <PendingButton
              type="submit"
              pending={operation === 'generate' && submission.pending}
              disabled={submission.pending}
              pendingLabel="Generating recovery codes…"
            >
              Generate new recovery codes
            </PendingButton>
          ) : (
            <PendingButton
              type="button"
              variant="outline"
              pending={operation === 'disable' && submission.pending}
              disabled={submission.pending}
              pendingLabel="Disabling two-factor authentication…"
              onClick={form.handleSubmit(async () => setConfirmDisable(true))}
            >
              Disable two-factor authentication
            </PendingButton>
          )}
        </FieldGroup>
      </form>
      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disable two-factor authentication?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your account will no longer require an authenticator code at sign
              in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              render={
                <PendingButton
                  pending={operation === 'disable' && submission.pending}
                  pendingLabel="Disabling two-factor authentication…"
                >
                  Disable two-factor authentication
                </PendingButton>
              }
              disabled={submission.pending}
              onClick={(event) => {
                event.preventDefault();
                void form.handleSubmit((input) =>
                  submission.run(async () => {
                    setOperation('disable');
                    try {
                      const result = await authClient.twoFactor.disable({
                        password: input.password,
                      });
                      if (result.error) throw new Error();
                      await onComplete();
                      form.reset();
                      setConfirmDisable(false);
                      toast.success('Two-factor authentication disabled.');
                    } catch {
                      setFailure(
                        'Unable to disable authentication. Confirm your identity and try again.',
                      );
                      setConfirmDisable(true);
                    } finally {
                      setOperation(null);
                    }
                  }),
                )();
              }}
            >
              Disable two-factor authentication
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      showBrandFooter={false}
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
      showBrandFooter={false}
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
