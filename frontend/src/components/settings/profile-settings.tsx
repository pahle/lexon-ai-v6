'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DisplayNameSchema, JOB_TITLE_MAX_LENGTH } from '@lexon/contracts';
import {
  SettingsField,
  SettingsHeading,
  settingsDescriptionClass,
  settingsLabelClass,
} from './settings-section';
import { useWorkspace } from '../shell/workspace-provider';
import {
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

const ProfileFormSchema = z.object({
  name: DisplayNameSchema,
  jobTitle: z
    .string()
    .trim()
    .max(JOB_TITLE_MAX_LENGTH, 'Use 80 characters or fewer.'),
});
type ProfileFormValues = z.input<typeof ProfileFormSchema>;

export function ProfileSettings(): React.ReactElement {
  const { identity, refreshIdentity } = useWorkspace();
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<
    ProfileFormValues,
    unknown,
    z.output<typeof ProfileFormSchema>
  >({
    resolver: zodResolver(ProfileFormSchema),
    defaultValues: {
      name: identity?.user.name ?? '',
      jobTitle: identity?.user.jobTitle ?? '',
    },
  });

  if (!identity) return <p role="status">Loading profile…</p>;

  return (
    <section aria-labelledby="profile-heading" className="flex flex-col gap-3">
      <SettingsHeading
        id="profile-heading"
        title="Profile"
        description="How you appear to people in your organizations."
      />
      <form
        noValidate
        onSubmit={form.handleSubmit((input) =>
          submission.run(async () => {
            setFailure('');
            try {
              await identityApi.updateProfile({
                name: input.name,
                jobTitle: input.jobTitle === '' ? null : input.jobTitle,
              });
              await refreshIdentity();
              toast.success('Changes saved.');
            } catch (error) {
              setFailure(identityMessage(error));
            }
          }),
        )}
      >
        <div className="flex flex-col gap-3">
          {failure ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to save your profile</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-0">
            <SettingsField data-invalid={Boolean(form.formState.errors.name)}>
              <FieldContent className="gap-0">
                <FieldLabel
                  htmlFor="profile-display-name"
                  className={settingsLabelClass}
                >
                  Display name
                </FieldLabel>
                <FieldDescription className={settingsDescriptionClass}>
                  How people in your organizations see you.
                </FieldDescription>
              </FieldContent>
              <FieldContent className="flex-none gap-1 md:items-end md:text-right">
                <Input
                  id="profile-display-name"
                  autoComplete="name"
                  aria-invalid={Boolean(form.formState.errors.name)}
                  aria-describedby={
                    form.formState.errors.name
                      ? 'profile-display-name-error'
                      : undefined
                  }
                  className="w-full md:w-[280px] md:max-w-[280px]"
                  {...form.register('name')}
                />
                {form.formState.errors.name ? (
                  <FieldError id="profile-display-name-error">
                    {form.formState.errors.name.message}
                  </FieldError>
                ) : null}
              </FieldContent>
            </SettingsField>
            <SettingsField
              data-invalid={Boolean(form.formState.errors.jobTitle)}
            >
              <FieldContent className="gap-0">
                <FieldLabel
                  htmlFor="profile-job-title"
                  className={settingsLabelClass}
                >
                  Job title
                </FieldLabel>
                <FieldDescription className={settingsDescriptionClass}>
                  Shown under your name in the sidebar.
                </FieldDescription>
              </FieldContent>
              <FieldContent className="flex-none gap-1 md:items-end md:text-right">
                <Input
                  id="profile-job-title"
                  autoComplete="organization-title"
                  aria-invalid={Boolean(form.formState.errors.jobTitle)}
                  aria-describedby={
                    form.formState.errors.jobTitle
                      ? 'profile-job-title-error'
                      : undefined
                  }
                  className="w-full md:w-[280px] md:max-w-[280px]"
                  {...form.register('jobTitle')}
                />
                {form.formState.errors.jobTitle ? (
                  <FieldError id="profile-job-title-error">
                    {form.formState.errors.jobTitle.message}
                  </FieldError>
                ) : null}
              </FieldContent>
            </SettingsField>
            <SettingsField>
              <FieldContent className="gap-0">
                <FieldTitle className={settingsLabelClass}>Email</FieldTitle>
                <FieldDescription className={settingsDescriptionClass}>
                  Used to sign in. Change it in Security.
                </FieldDescription>
              </FieldContent>
              <FieldContent className="flex-none gap-1 md:items-end md:text-right">
                <p className="min-w-0 text-sm break-words text-muted-foreground">
                  {identity.user.email}
                </p>
              </FieldContent>
            </SettingsField>
          </FieldGroup>
          <div className="mt-1 flex justify-end">
            <PendingButton
              className="[&_.invisible]:hidden"
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
