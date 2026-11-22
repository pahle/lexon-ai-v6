'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarIcon,
  ClockIcon,
  HashIcon,
  MailIcon,
  SendIcon,
  ShieldCheckIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  PasswordResetRequestInputSchema,
  type PasswordResetRequestInput,
  type PlatformMember,
  type PlatformOrganizationDetail,
} from '@lexon/contracts';
import {
  DetailsCard,
  IdentityCell,
  MutedCell,
  OpenCell,
  PagedFooter,
  RecordHeader,
  RecordPage,
  RelatedTable,
  StatTiles,
  StatusBadge,
  TagCell,
  type DataColumn,
} from '../data-views';
import { PendingButton } from '../forms/pending-button';
import { useSubmissionLock } from '../forms/use-submission-lock';
import { identityApi, identityMessage } from '../organizations/page-state';
import { PlatformField } from '../platform/platform-field';
import {
  capitalize,
  formatPlatformDate,
  formatPlatformTime,
} from '../platform/platform-format';
import { ListFailure } from '../states/list-failure';
import { Button } from '../ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { PlatformApiError, platformConsoleApi } from './api';
import {
  CancelProvisioningDialog,
  ORGANIZATIONS_KEY,
  organizationKey,
  resendOwnerInvitation,
} from './provisioning-actions';

type Active = Extract<PlatformOrganizationDetail, { state: 'active' }>;
type Provisioning = Extract<
  PlatformOrganizationDetail,
  { state: 'provisioning' }
>;

const MEMBERS_PAGE_SIZE = 50;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
const members = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`;

const memberColumns: DataColumn<PlatformMember>[] = [
  {
    key: 'member',
    header: 'Member',
    cell: (m) => (
      <IdentityCell
        name={m.name}
        secondary={m.email}
        initials={initials(m.name)}
      />
    ),
  },
  {
    key: 'role',
    header: 'Role',
    width: '110px',
    cell: (m) => <TagCell>{capitalize(m.role)}</TagCell>,
  },
  {
    key: 'joined',
    header: 'Joined',
    width: '130px',
    muted: true,
    cell: (m) => formatPlatformDate(m.joinedAt),
  },
  {
    key: 'open',
    header: 'Open',
    hideHeader: true,
    width: '56px',
    cell: (m) => (
      <OpenCell label={m.name} href={`/platform/accounts/${m.userId}`} />
    ),
  },
];

/** Members of an active organization; each page request is audited by the server. */
function MembersCard({ organization }: { organization: Active }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MEMBERS_PAGE_SIZE);
  const list = useQuery({
    queryKey: [...organizationKey(organization.id), 'members', page, pageSize],
    queryFn: () =>
      platformConsoleApi.members(organization.id, { page, pageSize }),
    retry: false,
  });
  const rows = list.data?.items ?? [];
  return (
    <RelatedTable
      title="Members"
      description="Opening this list is recorded in the audit log."
      columns={memberColumns}
      rows={rows}
      getRowId={(m) => m.userId}
      status={
        list.isPending
          ? 'loading'
          : list.isError
            ? 'error'
            : rows.length
              ? 'ready'
              : 'empty'
      }
      onRetry={() => void list.refetch()}
      thing="members"
      emptyTitle="No members"
      emptyText="This organization has no members."
      {...(list.data ? { count: list.data.total } : {})}
      mobileRow={(m) => ({
        lead: (
          <span
            aria-hidden="true"
            className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full text-xs font-semibold"
          >
            {initials(m.name)}
          </span>
        ),
        title: m.name,
        sub: m.email,
        badge: <TagCell>{capitalize(m.role)}</TagCell>,
        meta: (
          <MutedCell>{`Joined ${formatPlatformDate(m.joinedAt)}`}</MutedCell>
        ),
      })}
      footer={
        list.data ? (
          <PagedFooter
            page={page}
            pageSize={pageSize}
            total={list.data.total}
            noun="member"
            ready={!list.isFetching}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        ) : null
      }
    />
  );
}

function ActiveBody({ organization }: { organization: Active }) {
  const created = formatPlatformDate(organization.createdAt);
  return (
    <RecordPage>
      <RecordHeader
        backHref="/platform/organizations"
        backLabel="Organizations"
        initials={initials(organization.name)}
        square
        title={organization.name}
        badges={<StatusBadge>Active</StatusBadge>}
        meta={[
          { icon: HashIcon, text: organization.slug },
          { icon: CalendarIcon, text: `Created ${created}` },
          { icon: UsersIcon, text: members(organization.memberCount) },
        ]}
      />
      <StatTiles
        items={[
          {
            icon: UsersIcon,
            label: 'Members',
            value: String(organization.memberCount),
          },
          {
            icon: ShieldCheckIcon,
            label: 'Two-step verification',
            value: organization.requireTwoFactor ? 'Required' : 'Not required',
          },
          { icon: CalendarIcon, label: 'Created', value: created },
        ]}
      />
      <DetailsCard
        rows={[
          { label: 'Name', value: organization.name },
          { label: 'Slug', value: organization.slug },
          { label: 'Owner email', value: organization.ownerEmail },
          { label: 'Created', value: created },
          { label: 'Organization ID', value: organization.id, copy: true },
        ]}
      />
      <MembersCard key={organization.id} organization={organization} />
    </RecordPage>
  );
}

function ProvisioningBody({ organization }: { organization: Provisioning }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const submission = useSubmissionLock();
  const [pendingOperation, setPendingOperation] = useState<
    'resend' | 'replace' | null
  >(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const form = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestInputSchema),
    defaultValues: { email: '' },
  });
  const provisioned = formatPlatformDate(organization.createdAt);

  const resend = () =>
    void submission.run(async () => {
      setPendingOperation('resend');
      try {
        await resendOwnerInvitation(queryClient, organization.id);
      } finally {
        setPendingOperation(null);
      }
    });

  const replace = form.handleSubmit((input) =>
    submission.run(async () => {
      setPendingOperation('replace');
      try {
        await identityApi.replaceOwnerEmail(organization.id, input);
        form.reset();
        toast.success('Owner invitation updated.');
      } catch (error) {
        toast.error(identityMessage(error));
      } finally {
        void queryClient.invalidateQueries({
          queryKey: organizationKey(organization.id),
        });
        void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_KEY });
        setPendingOperation(null);
      }
    }),
  );

  return (
    <RecordPage>
      <RecordHeader
        backHref="/platform/organizations"
        backLabel="Organizations"
        initials={initials(organization.name)}
        square
        title={organization.name}
        badges={<StatusBadge>Provisioning</StatusBadge>}
        meta={[
          { icon: HashIcon, text: organization.slug },
          { icon: CalendarIcon, text: `Provisioned ${provisioned}` },
        ]}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={submission.pending}
              onClick={resend}
            >
              <MailIcon aria-hidden="true" />
              Resend invitation
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-lexon-red-text"
              disabled={submission.pending}
              onClick={() => setConfirmCancel(true)}
            >
              <XIcon aria-hidden="true" />
              Cancel provisioning
            </Button>
          </>
        }
      />
      <StatTiles
        items={[
          {
            icon: MailIcon,
            label: 'Owner invitation',
            value: capitalize(organization.invitation.status),
          },
          {
            icon: ClockIcon,
            label: 'Expires',
            value: formatPlatformDate(organization.invitation.expiresAt),
            supporting: formatPlatformTime(organization.invitation.expiresAt),
          },
          {
            icon: UsersIcon,
            label: 'Members',
            value: String(organization.memberCount),
            supporting: 'Until the owner accepts',
          },
        ]}
      />
      <DetailsCard
        rows={[
          { label: 'Name', value: organization.name },
          { label: 'Slug', value: organization.slug },
          { label: 'Owner email', value: organization.ownerEmail },
          { label: 'Provisioned', value: provisioned },
          { label: 'Organization ID', value: organization.id, copy: true },
        ]}
      />
      <section
        aria-labelledby="replace-owner-email"
        className="border-border bg-background rounded-xl border"
      >
        <div className="px-4 py-3.5 md:px-5 md:py-4">
          <h2 id="replace-owner-email" className="text-[15px] font-semibold">
            Replace owner email
          </h2>
          <p className="text-muted-foreground mt-0.5 text-[13px] leading-normal">
            Sends a new invitation to a different person. The current invitation
            stops working.
          </p>
        </div>
        <form
          noValidate
          onSubmit={replace}
          className="flex flex-wrap items-end gap-3 px-4 pb-4 md:px-5 md:pb-5"
        >
          <div className="min-w-[220px] flex-1">
            <PlatformField
              label="New owner email"
              type="email"
              autoComplete="email"
              placeholder="owner@firm.co.id"
              disabled={submission.pending}
              registration={form.register('email')}
              error={form.formState.errors.email}
            />
          </div>
          <PendingButton
            type="submit"
            pending={submission.pending && pendingOperation === 'replace'}
            disabled={submission.pending}
            pendingLabel="Replacing…"
          >
            <SendIcon aria-hidden="true" />
            Replace and send
          </PendingButton>
        </form>
      </section>
      <CancelProvisioningDialog
        open={confirmCancel}
        organization={organization}
        onClose={() => setConfirmCancel(false)}
        onCancelled={() => router.push('/platform/organizations')}
      />
    </RecordPage>
  );
}

/** One team organization: the active record with members, or the provisioning record with its owner invitation. */
export function OrganizationRecord({
  organizationId,
}: {
  organizationId: string;
}) {
  const query = useQuery({
    queryKey: organizationKey(organizationId),
    queryFn: () => platformConsoleApi.organization(organizationId),
    retry: false,
  });
  if (query.isPending)
    return (
      <RecordPage>
        <div role="status" aria-busy="true" aria-label="Loading organization">
          <Skeleton className="h-14 w-72" />
          <Skeleton className="mt-6 h-24 w-full" />
        </div>
      </RecordPage>
    );
  if (query.error instanceof PlatformApiError && query.error.status === 404)
    return (
      <RecordPage>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Organization not found</EmptyTitle>
            <EmptyDescription>
              It may have been removed, or the link is wrong.{' '}
              <a href="/platform/organizations" className="underline">
                Back to organizations
              </a>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </RecordPage>
    );
  if (query.isError)
    return (
      <RecordPage>
        <ListFailure
          thing="this organization"
          onRetry={() => void query.refetch()}
        />
      </RecordPage>
    );
  return query.data.state === 'active' ? (
    <ActiveBody organization={query.data} />
  ) : (
    <ProvisioningBody organization={query.data} />
  );
}
