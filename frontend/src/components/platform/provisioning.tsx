'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ProvisioningInputSchema,
  type ProvisioningInput,
} from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
  useCursorPage,
} from '../organizations/page-state';
import { FormInput } from '../auth/form-input';
import { FieldGroup } from '../ui/field';
import { Alert, AlertDescription } from '../ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';

export function ProvisioningList() {
  const queryClient = useQueryClient();
  const submission = useSubmissionLock();
  const [failure, setFailure] = useState('');
  const list = useCursorPage(['platform', 'provisioning'], (cursor) =>
    identityApi.listProvisioning({ limit: 20, ...(cursor ? { cursor } : {}) }),
  );
  const form = useForm<ProvisioningInput>({
    resolver: zodResolver(ProvisioningInputSchema),
    defaultValues: { name: '', slug: '', ownerEmail: '' },
  });

  async function provision(input: ProvisioningInput) {
    setFailure('');
    await submission.run(async () => {
      try {
        await identityApi.createProvisioning(input);
        form.reset();
        await queryClient.invalidateQueries({
          queryKey: ['platform', 'provisioning'],
        });
        toast.success('Organization provisioning started.');
      } catch (error) {
        setFailure(identityMessage(error));
      }
    });
  }

  if (list.query.error) return <QueryFailure error={list.query.error} />;
  if (!list.query.data) {
    return (
      <section
        role="status"
        aria-label="Checking platform access"
        className="flex flex-col gap-3"
      >
        <p className="text-sm text-muted-foreground">
          Checking platform access…
        </p>
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Provision a team organization</CardTitle>
          <CardDescription>
            A provisioning team has no members or content until its first owner
            accepts the invitation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={form.handleSubmit(provision)}>
            <FieldGroup>
              <FormInput
                label="Organization name"
                registration={form.register('name')}
                error={form.formState.errors.name}
              />
              <FormInput
                label="Organization slug"
                registration={form.register('slug')}
                error={form.formState.errors.slug}
              />
              <FormInput
                label="First owner email"
                type="email"
                autoComplete="email"
                registration={form.register('ownerEmail')}
                error={form.formState.errors.ownerEmail}
              />
              {failure ? (
                <Alert variant="destructive">
                  <AlertDescription>{failure}</AlertDescription>
                </Alert>
              ) : null}
              <PendingButton
                type="submit"
                pending={submission.pending}
                pendingLabel="Provisioning…"
              >
                Provision organization
              </PendingButton>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <section
        aria-labelledby="provisioning-heading"
        className="flex flex-col gap-4"
      >
        <header>
          <h2 id="provisioning-heading" className="text-lg font-medium">
            Provisioning organizations
          </h2>
          <p className="text-sm text-muted-foreground">
            Organizations awaiting their first owner.
          </p>
        </header>
        {list.query.data.items.length === 0 ? (
          <Empty className="min-h-48 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <span aria-hidden="true">◇</span>
              </EmptyMedia>
              <EmptyTitle>No provisioning organizations</EmptyTitle>
              <EmptyDescription>
                New teams waiting for an owner will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-md border">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Owner invitation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.query.data.items.map((organization) => (
                  <TableRow key={organization.id}>
                    <TableCell className="font-medium">
                      <Link
                        className="underline underline-offset-4"
                        href={'/platform/provisioning/' + organization.id}
                      >
                        {organization.name}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">
                      {organization.state}
                    </TableCell>
                    <TableCell className="capitalize">
                      {organization.invitation.status}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {list.pagination}
      </section>
    </div>
  );
}
