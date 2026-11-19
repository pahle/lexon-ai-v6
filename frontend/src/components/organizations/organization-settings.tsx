'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  OrganizationSettingsInputSchema,
  type OrganizationSettingsInput,
  type OrganizationSummary,
} from '@lexon/contracts';
import {
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '../ui/field';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { FormAlert } from '../forms/form-alert';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import {
  IdentityClientError,
  SLUG_TAKEN_MESSAGE,
} from '../../lib/identity-client';
import { identityApi, identityMessage, saveFailureMessage } from './page-state';
import {
  SettingsField,
  SettingsHeading,
  settingsDescriptionClass,
  settingsLabelClass,
} from '../settings/settings-section';

export function OrganizationSettings({
  organization,
}: {
  organization: OrganizationSummary;
  embeddedInSettings?: boolean;
}) {
  const [current, setCurrent] = useState(organization);
  const [failure, setFailure] = useState('');
  const submission = useSubmissionLock();
  const form = useForm<OrganizationSettingsInput>({
    resolver: zodResolver(OrganizationSettingsInputSchema),
    defaultValues: { name: organization.name, slug: organization.slug },
  });

  useEffect(() => {
    setCurrent(organization);
    form.reset({ name: organization.name, slug: organization.slug });
    setFailure('');
  }, [form, organization]);

  if (organization.kind === 'personal' || organization.role !== 'owner') {
    return (
      <p className="text-sm text-muted-foreground">
        Only team owners can change organization settings. Personal cannot be
        renamed.
      </p>
    );
  }

  async function saveDetails(input: OrganizationSettingsInput) {
    setFailure('');
    await submission.run(async () => {
      try {
        const updated = await identityApi.updateOrganization(
          organization.id,
          input,
        );
        setCurrent(updated);
        form.reset({ name: updated.name, slug: updated.slug });
        toast.success('Organization settings saved.');
      } catch (error) {
        if (
          error instanceof IdentityClientError &&
          error.code === 'ORG_SLUG_TAKEN'
        ) {
          // Only the rejected value reverts; the other typed values stay.
          form.setValue('slug', current.slug);
          form.setError('slug', { message: SLUG_TAKEN_MESSAGE });
          return;
        }
        setFailure(saveFailureMessage('the organization settings', error));
      }
    });
  }

  async function updateTwoFactor(require2fa: boolean) {
    setFailure('');
    await submission.run(async () => {
      try {
        setCurrent(
          await identityApi.updateOrganization(organization.id, { require2fa }),
        );
        toast.success('Organization security setting saved.');
      } catch (error) {
        setFailure(identityMessage(error));
      }
    });
  }

  return (
    <section
      aria-labelledby="organization-general-heading"
      className="flex flex-col gap-3"
    >
      <SettingsHeading
        id="organization-general-heading"
        title="General"
        description={`Settings for everyone in ${current.name}.`}
      />
      {failure ? <FormAlert>{failure}</FormAlert> : null}
      <form noValidate onSubmit={form.handleSubmit(saveDetails)}>
        <FieldGroup className="gap-0">
          <SettingsField data-invalid={!!form.formState.errors.name}>
            <FieldContent className="gap-0">
              <FieldLabel
                htmlFor="organization-name"
                className={settingsLabelClass}
              >
                Organization name
              </FieldLabel>
              <FieldDescription className={settingsDescriptionClass}>
                Shown in the organization switcher.
              </FieldDescription>
            </FieldContent>
            <FieldContent className="flex-none gap-1 md:items-end">
              <Input
                id="organization-name"
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={
                  form.formState.errors.name
                    ? 'organization-name-error'
                    : undefined
                }
                {...form.register('name')}
                className="w-full md:w-[280px] md:max-w-[280px]"
              />
              {form.formState.errors.name ? (
                <FieldError id="organization-name-error">
                  {form.formState.errors.name.message}
                </FieldError>
              ) : null}
            </FieldContent>
          </SettingsField>
          <SettingsField data-invalid={!!form.formState.errors.slug}>
            <FieldContent className="gap-0">
              <FieldLabel
                htmlFor="organization-slug"
                className={settingsLabelClass}
              >
                Slug
              </FieldLabel>
              <FieldDescription className={settingsDescriptionClass}>
                Used in links. Lowercase letters, numbers, and hyphens.
              </FieldDescription>
            </FieldContent>
            <FieldContent className="flex-none gap-1 md:items-end md:text-right">
              <Input
                id="organization-slug"
                aria-invalid={!!form.formState.errors.slug}
                aria-describedby={
                  form.formState.errors.slug
                    ? 'organization-slug-error'
                    : undefined
                }
                {...form.register('slug')}
                className="w-full md:w-[280px] md:max-w-[280px]"
              />
              {form.formState.errors.slug ? (
                <FieldError id="organization-slug-error">
                  {form.formState.errors.slug.message}
                </FieldError>
              ) : null}
            </FieldContent>
          </SettingsField>
          <SettingsField inline>
            <FieldContent className="gap-0">
              <FieldTitle className={settingsLabelClass}>
                Require two-step verification
              </FieldTitle>
              <FieldDescription className={settingsDescriptionClass}>
                Members without it must set it up before they can open this
                workspace.
              </FieldDescription>
            </FieldContent>
            <FieldContent className="flex-none">
              <Switch
                aria-label="Require two-factor authentication"
                checked={current.require2fa}
                disabled={submission.pending}
                onCheckedChange={(checked) => void updateTwoFactor(checked)}
              />
            </FieldContent>
          </SettingsField>
          <div className="flex justify-end pt-4">
            <PendingButton
              className="bg-clip-border [&_.invisible]:hidden"
              type="submit"
              pending={submission.pending}
              pendingLabel="Saving…"
            >
              Save changes
            </PendingButton>
          </div>
        </FieldGroup>
      </form>
    </section>
  );
}
