'use client';
import { useState } from 'react';
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
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
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
        title="Welcome to Lexon"
        description="Choose the name people see."
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
              <Alert role="alert" variant="destructive">
                <AlertTitle>Unable to save your profile</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}
            <FormInput
              label="Display name"
              autoComplete="name"
              registration={form.register('name')}
              error={form.formState.errors.name}
            />
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Saving profile…"
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
        title="Pending invitations"
        description="Accept an invitation explicitly, or continue with your Personal organization."
      >
        <PendingInvitations initial={invitations} />
        <Button onClick={() => setStep(2)}>Continue</Button>
      </AuthCard>
    );
  return (
    <AuthCard
      presentation="page"
      title="Create a team, or start on your own"
      description="Creating a team is optional. Personal is ready to use."
    >
      <CreateTeam />
      {failure ? (
        <Alert role="alert" variant="destructive">
          <AlertTitle>Unable to finish onboarding</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <PendingButton
        pending={busy}
        pendingLabel="Finishing onboarding…"
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
      <ul>
        {(query.data?.items ?? initial)
          .filter((invitation) => invitation.status === 'pending')
          .map((invitation) => (
            <li key={invitation.id}>
              <a href={'/accept-invitation?invitationId=' + invitation.id}>
                {invitation.organizationName}
              </a>
            </li>
          ))}
      </ul>
      {pagination}
    </>
  );
}
