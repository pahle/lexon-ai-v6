'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ProfileInputSchema, type ProfileInput } from '@lexon/contracts';
import { useWorkspace } from '../shell/workspace-provider';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '../ui/field';
import { Input } from '../ui/input';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { identityApi, identityMessage } from '../organizations/page-state';
import { toast } from 'sonner';

export function ProfileSettings(): React.ReactElement {
  const { identity, refreshIdentity } = useWorkspace();
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<ProfileInput>({
    resolver: zodResolver(ProfileInputSchema),
    defaultValues: { name: identity?.user.name ?? '' },
  });

  if (!identity) return <p role="status">Loading profile…</p>;

  return (
    <section aria-labelledby="profile-heading" className="flex flex-col gap-5">
      <header>
        <h2 id="profile-heading" className="text-lg font-medium">
          Profile
        </h2>
      </header>
      <form
        noValidate
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
            setFailure('');
            try {
              await identityApi.updateProfile(input);
              await refreshIdentity();
              toast.success('Changes saved.');
            } catch (error) {
              setFailure(identityMessage(error));
            }
          }),
        )}
      >
        <div className="flex flex-col gap-5">
          {failure ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to save your profile</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-0">
            <Field
              orientation="responsive"
              data-invalid={Boolean(form.formState.errors.name)}
              className="border-b py-4 first:pt-0"
            >
              <FieldContent>
                <FieldLabel htmlFor="profile-display-name">
                  Display name
                </FieldLabel>
                <FieldDescription>
                  How people in your organizations see you.
                </FieldDescription>
              </FieldContent>
              <FieldContent className="md:items-end md:text-right">
                <Input
                  id="profile-display-name"
                  autoComplete="name"
                  aria-invalid={Boolean(form.formState.errors.name)}
                  aria-describedby={
                    form.formState.errors.name
                      ? 'profile-display-name-error'
                      : undefined
                  }
                  className="w-full md:max-w-[17.5rem]"
                  {...form.register('name')}
                />
                {form.formState.errors.name ? (
                  <FieldError id="profile-display-name-error">
                    {form.formState.errors.name.message}
                  </FieldError>
                ) : null}
              </FieldContent>
            </Field>
            <Field orientation="responsive" className="border-b py-4">
              <FieldContent>
                <FieldTitle>Email</FieldTitle>
                <FieldDescription>
                  Used to sign in. Change it in Security.
                </FieldDescription>
              </FieldContent>
              <FieldContent className="md:items-end md:text-right">
                <p className="min-w-0 break-words text-sm">
                  {identity.user.email}
                </p>
              </FieldContent>
            </Field>
            <Field orientation="responsive" className="border-b py-4">
              <FieldContent>
                <FieldTitle>Active organization</FieldTitle>
                <FieldDescription>Switch from the sidebar.</FieldDescription>
              </FieldContent>
              <FieldContent className="md:items-end md:text-right">
                <p className="min-w-0 break-words text-sm">
                  {identity.organization.kind === 'personal'
                    ? 'Personal'
                    : identity.organization.name}
                </p>
              </FieldContent>
            </Field>
          </FieldGroup>
          <div className="flex justify-end">
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Saving…"
            >
              Save
            </PendingButton>
          </div>
        </div>
      </form>
    </section>
  );
}
