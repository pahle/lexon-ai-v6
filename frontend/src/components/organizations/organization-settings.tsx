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
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '../ui/field';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Alert, AlertDescription } from '../ui/alert';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { identityApi, identityMessage } from './page-state';

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
        setFailure(identityMessage(error));
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
      className="flex flex-col gap-5"
    >
      <h2 id="organization-general-heading" className="text-lg font-medium">
        General
      </h2>
      {failure ? (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <form noValidate onSubmit={form.handleSubmit(saveDetails)}>
        <FieldGroup className="gap-0">
          <Field
            data-invalid={!!form.formState.errors.name}
            orientation="responsive"
            className="border-b py-4"
          >
            <FieldContent>
              <FieldLabel htmlFor="organization-name">
                Organization name
              </FieldLabel>
            </FieldContent>
            <FieldContent className="md:items-end">
              <Input
                id="organization-name"
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={
                  form.formState.errors.name
                    ? 'organization-name-error'
                    : undefined
                }
                {...form.register('name')}
                className="w-full md:max-w-[17.5rem]"
              />
              {form.formState.errors.name ? (
                <FieldError id="organization-name-error">
                  {form.formState.errors.name.message}
                </FieldError>
              ) : null}
            </FieldContent>
          </Field>
          <Field
            data-invalid={!!form.formState.errors.slug}
            orientation="responsive"
            className="border-b py-4"
          >
            <FieldContent>
              <FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
              <FieldDescription>
                Lowercase letters, numbers and hyphens.
              </FieldDescription>
            </FieldContent>
            <FieldContent className="md:items-end md:text-right">
              <Input
                id="organization-slug"
                aria-invalid={!!form.formState.errors.slug}
                aria-describedby={
                  form.formState.errors.slug
                    ? 'organization-slug-error'
                    : undefined
                }
                {...form.register('slug')}
                className="w-full md:max-w-[17.5rem]"
              />
              {form.formState.errors.slug ? (
                <FieldError id="organization-slug-error">
                  {form.formState.errors.slug.message}
                </FieldError>
              ) : null}
            </FieldContent>
          </Field>
          <Field orientation="responsive" className="py-4">
            <FieldContent>
              <FieldTitle>Require two-factor authentication</FieldTitle>
              <FieldDescription>
                Members without 2FA must set it up before entering.
              </FieldDescription>
            </FieldContent>
            <FieldContent className="md:items-end">
              <Switch
                aria-label="Require two-factor authentication"
                checked={current.require2fa}
                disabled={submission.pending}
                onCheckedChange={(checked) => void updateTwoFactor(checked)}
              />
            </FieldContent>
          </Field>
          <div className="flex justify-end pt-4">
            <PendingButton
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
