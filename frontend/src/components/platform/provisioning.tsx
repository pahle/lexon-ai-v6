'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import {
  ChevronRightIcon,
  CircleAlertIcon,
  RefreshCwIcon,
  UsersIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ProvisioningInputSchema,
  type ProvisioningInput,
} from '@lexon/contracts';
import { IdentityClientError } from '../../lib/identity-client';
import {
  identityApi,
  identityMessage,
  QueryFailure,
  useCursorPage,
} from '../organizations/page-state';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
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
import { cn } from '../../lib/utils';
import { PlatformActions, PlatformCard } from './platform-card';
import { PlatformField } from './platform-field';
import { capitalize, formatPlatformDate } from './platform-format';

const rowGrid =
  'grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t px-4 py-3 text-sm first:border-t-0 md:grid-cols-[1.6fr_1fr_1fr_24px] md:gap-4 md:py-0 md:min-h-14';

/** Pending reads as an outline badge; anything that needs attention in red. */
export function InvitationBadge({ status }: { status: string }) {
  const attention = status === 'expired';
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-input',
        attention && 'border-lexon-red-text/45 text-lexon-red-text',
      )}
    >
      {capitalize(status)}
    </Badge>
  );
}

function TableHeadRow() {
  return (
    <thead className="block max-md:hidden">
      <tr
        role="row"
        className="grid min-h-10 grid-cols-[1.6fr_1fr_1fr_24px] items-center gap-4 bg-muted px-4 text-left text-[13px] font-medium text-muted-foreground"
      >
        <th role="columnheader" className="text-left font-medium">
          Organization
        </th>
        <th role="columnheader" className="text-left font-medium">
          Owner invitation
        </th>
        <th role="columnheader" className="text-left font-medium">
          Expires
        </th>
        <th role="columnheader" className="sr-only">
          Open
        </th>
      </tr>
    </thead>
  );
}

const tableShell = 'block w-full overflow-hidden rounded-xl border text-sm';

function TableSkeleton() {
  return (
    <table role="table" aria-hidden="true" className={tableShell}>
      <TableHeadRow />
      <tbody className="block">
        {[60, 44, 52].map((width) => (
          <tr key={width} role="row" className={rowGrid}>
            <td role="cell">
              <Skeleton style={{ width: width + '%' }} />
            </td>
            <td role="cell" className="max-md:col-start-1">
              <Skeleton className="w-16" />
            </td>
            <td role="cell" className="max-md:col-start-1">
              <Skeleton className="w-[88px]" />
            </td>
            <td role="cell" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The form card as it looks before the server has authorized the page. */
function FormSkeleton() {
  return (
    <PlatformCard
      title="Provision a team organization"
      description="The organization has no members or content until its first owner accepts the invitation."
    >
      <div aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {['Organization name', 'Organization slug', 'First owner email'].map(
          (label, index) => (
            <div
              key={label}
              className={cn(
                'flex flex-col gap-2',
                index === 2 && 'md:col-span-2',
              )}
            >
              <span className="text-sm font-medium">{label}</span>
              <div className="h-9 rounded-[8px] border border-input" />
            </div>
          ),
        )}
      </div>
      <PlatformActions>
        <div className="h-8 w-[173px] rounded-[8px] bg-muted" />
      </PlatformActions>
    </PlatformCard>
  );
}

function SectionHeading() {
  return (
    <div>
      <h2 id="provisioning-heading" className="text-base font-semibold">
        Awaiting first owner
      </h2>
      <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
        Organizations stay in provisioning until the first owner accepts the
        invitation.
      </p>
    </div>
  );
}

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

  const error = list.query.error;
  // Denied or signed-out: no form and no list, only the access options.
  if (
    error &&
    error instanceof IdentityClientError &&
    (error.status === 401 || error.status === 403)
  )
    return <QueryFailure error={error} />;
  if (!error && !list.query.data) {
    return (
      <div
        role="status"
        aria-label="Checking platform access"
        className="flex flex-col gap-6"
      >
        <FormSkeleton />
        <section className="flex flex-col gap-3">
          <SectionHeading />
          <TableSkeleton />
        </section>
      </div>
    );
  }
  const items = list.query.data?.items ?? [];
  return (
    <>
      <PlatformCard
        title="Provision a team organization"
        description="The organization has no members or content until its first owner accepts the invitation."
      >
        <form
          noValidate
          onSubmit={form.handleSubmit(provision)}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PlatformField
              label="Organization name"
              placeholder="Hukum Nusantara"
              registration={form.register('name')}
              error={form.formState.errors.name}
            />
            <PlatformField
              label="Organization slug"
              placeholder="hukum-nusantara"
              hint="Lowercase letters, numbers, and hyphens."
              registration={form.register('slug')}
              error={form.formState.errors.slug}
            />
            <PlatformField
              label="First owner email"
              type="email"
              autoComplete="email"
              placeholder="owner@firm.co.id"
              className="md:col-span-2"
              registration={form.register('ownerEmail')}
              error={form.formState.errors.ownerEmail}
            />
          </div>
          {failure ? (
            <Alert variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
          <PlatformActions>
            <PendingButton
              type="submit"
              pending={submission.pending}
              pendingLabel="Provisioning…"
            >
              Provision organization
            </PendingButton>
          </PlatformActions>
        </form>
      </PlatformCard>

      <section
        aria-labelledby="provisioning-heading"
        className="flex flex-col gap-3"
      >
        <SectionHeading />
        {error ? (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-xl border bg-muted py-2.5 pr-2.5 pl-3.5 text-[15px]"
          >
            <CircleAlertIcon
              aria-hidden="true"
              className="size-[18px] shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1">{identityMessage(error)}</span>
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => void list.query.refetch()}
            >
              <RefreshCwIcon
                aria-hidden="true"
                data-icon="inline-start"
                className="size-3.5"
              />
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <Empty className="gap-2 rounded-xl border border-dashed py-10">
            <EmptyHeader className="max-w-none gap-2">
              <EmptyMedia
                variant="icon"
                className="mb-0 size-10 rounded-[10px] [&_svg:not([class*='size-'])]:size-5"
              >
                <UsersIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-base font-semibold tracking-normal">
                No provisioning organizations
              </EmptyTitle>
              <EmptyDescription className="text-sm/normal">
                Organizations you provision appear here until their first owner
                accepts.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <table
            role="table"
            aria-labelledby="provisioning-heading"
            className={tableShell}
          >
            <TableHeadRow />
            <tbody className="block">
              {items.map((organization) => (
                <tr
                  key={organization.id}
                  role="row"
                  className={cn(rowGrid, 'relative')}
                >
                  <td
                    role="cell"
                    className="flex min-w-0 flex-col leading-[1.35]"
                  >
                    <Link
                      className="w-fit font-medium outline-none after:absolute after:inset-0 focus-visible:after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                      href={'/platform/provisioning/' + organization.id}
                    >
                      {organization.name}
                    </Link>
                    <small className="text-xs text-muted-foreground">
                      {organization.slug}
                    </small>
                  </td>
                  <td role="cell" className="max-md:col-start-1">
                    <InvitationBadge status={organization.invitation.status} />
                  </td>
                  <td
                    role="cell"
                    className="max-md:col-start-1 max-md:text-[13px] max-md:text-muted-foreground"
                  >
                    {formatPlatformDate(organization.invitation.expiresAt)}
                  </td>
                  <td
                    role="cell"
                    className="flex text-muted-foreground max-md:col-start-2 max-md:[grid-row:1/3]"
                  >
                    <ChevronRightIcon aria-hidden="true" className="size-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.pagination}
      </section>
    </>
  );
}
