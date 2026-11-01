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
import { FieldGroup, FieldError } from '../ui/field';
import { Button } from '../ui/button';
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
  });
  if (step === 0)
    return (
      <AuthCard
        title="Welcome to Lexon"
        description="Choose the name people see."
      >
        <form
          noValidate
          onSubmit={form.handleSubmit(async (input) => {
            try {
              await identityApi.updateProfile(input);
              setStep(1);
              setFailure('');
            } catch (error) {
              setFailure(identityMessage(error));
            }
          })}
        >
          <FieldGroup>
            <FormInput
              label="Display name"
              autoComplete="name"
              registration={form.register('name')}
              error={form.formState.errors.name}
            />
            {failure ? <FieldError>{failure}</FieldError> : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Continue
            </Button>
          </FieldGroup>
        </form>
      </AuthCard>
    );
  if (step === 1)
    return (
      <AuthCard
        title="Pending invitations"
        description="Accept an invitation explicitly, or continue with your Personal organization."
      >
        <PendingInvitations initial={invitations} />
        <Button onClick={() => setStep(2)}>Continue</Button>
      </AuthCard>
    );
  return (
    <AuthCard
      title="Create a team, or start on your own"
      description="Creating a team is optional. Personal is ready to use."
    >
      <CreateTeam />
      {failure ? <FieldError>{failure}</FieldError> : null}
      <Button
        disabled={busy}
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
      </Button>
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
