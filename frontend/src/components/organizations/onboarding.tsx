'use client';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ProfileInputSchema,
  type ProfileInput,
  type SafeProfile,
  type InvitationSummary,
} from '@lexon/contracts';
import { AuthCard } from '../auth/auth-card';
import { FormInput } from '../auth/form-input';
import { FieldGroup } from '../ui/field';
import { Button } from '../ui/button';
import { AuthAlert, AuthSteps, authButtonClass } from '../auth/auth-parts';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { CreateTeam } from './create-team';
import {
  identityApi,
  identityMessage,
  useCursorPage,
  QueryFailure,
} from './page-state';
export function Onboarding({
  profile,
  invitations,
}: {
  profile: SafeProfile;
  invitations: readonly InvitationSummary[];
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const form = useForm<ProfileInput>({
    resolver: zodResolver(ProfileInputSchema),
    defaultValues: { name: profile.name },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const submission = useSubmissionLock();
  if (step === 0)
    return (
      <AuthCard
        presentation="page"
        eyebrow={<AuthSteps step={1} />}
        title="Welcome to Lexon"
        description="Choose the name people see. You can change it later in Settings."
      >
        <form
          noValidate
          method="post"
          onSubmit={form.handleSubmit((input) =>
            submission.run(async () => {
              try {
                await identityApi.updateProfile(input);
                setStep(1);
                setFailure('');
              } catch (error) {
                setFailure(identityMessage(error));
              }
            }),
          )}
        >
          <FieldGroup>
            {failure ? (
              <AuthAlert title="Unable to save your profile">
                {failure}
              </AuthAlert>
            ) : null}
            <FormInput
              label="Display name"
              autoComplete="name"
              registration={form.register('name')}
              error={form.formState.errors.name}
              placeholder="Ayu Wardani"
            />
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Saving profile…"
              size="lg"
              className={authButtonClass}
            >
              Continue
            </PendingButton>
          </FieldGroup>
        </form>
      </AuthCard>
    );
  if (step === 1)
    return (
      <AuthCard
        presentation="page"
        eyebrow={<AuthSteps step={2} />}
        title="Pending invitations"
        description="Accept an invitation, or continue with your Personal workspace."
      >
        <PendingInvitations initial={invitations} />
        <Button
          size="lg"
          className={authButtonClass}
          onClick={() => setStep(2)}
        >
          Continue
        </Button>
      </AuthCard>
    );
  return (
    <AuthCard
      presentation="page"
      eyebrow={<AuthSteps step={3} />}
      title="Create a team, or start on your own"
      description="Creating a team is optional. Personal is ready to use."
    >
      <CreateTeam presentation="auth" />
      {failure ? (
        <AuthAlert title="Unable to finish onboarding">{failure}</AuthAlert>
      ) : null}
      <PendingButton
        pending={busy}
        pendingLabel="Finishing onboarding…"
        size="lg"
        className={authButtonClass}
        onClick={async () => {
          setBusy(true);
          try {
            await identityApi.completeOnboarding();
            window.location.assign('/workspace');
          } catch (error) {
            setFailure(identityMessage(error));
            setBusy(false);
          }
        }}
      >
        Finish onboarding
      </PendingButton>
    </AuthCard>
  );
}

function PendingInvitations({
  initial,
}: {
  initial: readonly InvitationSummary[];
}) {
  const { query, pagination } = useCursorPage(
    ['account', 'invitations'],
    (cursor) =>
      identityApi.listMyInvitations({
        limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
  );
  if (query.error) return <QueryFailure error={query.error} />;
  return (
    <>
      <ul className="flex flex-col gap-3">
        {(query.data?.items ?? initial)
          .filter((invitation) => invitation.status === 'pending')
          .map((invitation) => (
            <li key={invitation.id}>
              <a
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 text-inherit no-underline"
                href={'/accept-invitation?invitationId=' + invitation.id}
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sidebar-primary text-xs font-semibold tracking-wide text-sidebar-primary-foreground"
                >
                  {invitation.organizationName.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate font-medium">
                    {invitation.organizationName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Review the invitation
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </a>
            </li>
          ))}
      </ul>
      {pagination}
    </>
  );
}
