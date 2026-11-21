'use client';

import { useQuery } from '@tanstack/react-query';
import { EyeIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlatformOrganizationSummary } from '@lexon/contracts';
import {
  DataListPage,
  DataStates,
  DataTable,
  DataTableCard,
  DataToolbar,
  FacetFilter,
  IdentityCell,
  PagedFooter,
  RowMenu,
  StatusBadge,
  useDataViewParams,
  type DataColumn,
} from '../data-views';
import { QueryFailure } from '../organizations/page-state';
import { formatPlatformDate } from '../platform/platform-format';
import { Button } from '../ui/button';
import { PlatformApiError, platformConsoleApi } from './api';
import { ProvisionDialog } from './provision-dialog';

const STATE = [
  { value: 'active', label: 'Active' },
  { value: 'provisioning', label: 'Provisioning' },
];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** Every team organization on Lexon; personal workspaces are not listed. */
export function OrganizationsPage() {
  const router = useRouter();
  const view = useDataViewParams(['state']);
  const [provisioning, setProvisioning] = useState(false);
  const state = view.facets.state ?? [];
  const list = useQuery({
    queryKey: [
      'platform',
      'organizations',
      view.query,
      state,
      view.page,
      view.pageSize,
    ],
    queryFn: () =>
      platformConsoleApi.listOrganizations({
        query: view.query,
        state,
        page: view.page,
        pageSize: view.pageSize,
      }),
    retry: false,
  });
  const filtered = Boolean(view.query || state.length);
  const rows = list.data?.items ?? [];
  const status = list.isPending
    ? 'loading'
    : list.isError
      ? 'error'
      : rows.length
        ? 'ready'
        : filtered
          ? 'no-results'
          : 'empty';
  const open = (row: PlatformOrganizationSummary) =>
    router.push(`/platform/organizations/${row.id}`);
  const provision = (
    <Button type="button" onClick={() => setProvisioning(true)}>
      <PlusIcon aria-hidden="true" />
      Provision organization
    </Button>
  );

  const columns: DataColumn<PlatformOrganizationSummary>[] = [
    {
      key: 'organization',
      header: 'Organization',
      cell: (o) => (
        <IdentityCell
          shape="organization"
          name={o.name}
          secondary={o.slug}
          initials={initials(o.name)}
        />
      ),
    },
    {
      key: 'state',
      header: 'State',
      width: '128px',
      cell: (o) => (
        <StatusBadge>
          {o.state === 'active' ? 'Active' : 'Provisioning'}
        </StatusBadge>
      ),
    },
    {
      key: 'members',
      header: 'Members',
      width: '96px',
      numeric: true,
      cell: (o) => (o.state === 'active' ? o.memberCount : '—'),
    },
    { key: 'owner', header: 'Owner', muted: true, cell: (o) => o.ownerEmail },
    {
      key: 'created',
      header: 'Created',
      width: '124px',
      muted: true,
      cell: (o) => formatPlatformDate(o.createdAt),
    },
    {
      key: 'menu',
      header: 'Actions',
      hideHeader: true,
      width: '56px',
      cell: (o) => (
        <RowMenu
          label={`Actions for ${o.name}`}
          items={[
            {
              label: 'View organization',
              icon: EyeIcon,
              onSelect: () => open(o),
            },
          ]}
        />
      ),
    },
  ];

  if (
    list.error instanceof PlatformApiError &&
    (list.error.status === 401 || list.error.status === 403)
  )
    return <QueryFailure error={list.error} />;

  const reset = () => view.set({ query: '', facets: { state: [] } });
  return (
    <DataListPage
      title="Organizations"
      description="Every team organization on Lexon. Personal workspaces are not listed."
      {...(status === 'empty' ? {} : { action: provision })}
    >
      <DataTableCard
        toolbar={
          <DataToolbar
            query={view.query}
            onQuery={(query) => view.set({ query })}
            onReset={reset}
            hasFilters={filtered}
            placeholder="Search by name or slug"
            facets={
              <FacetFilter
                label="State"
                options={STATE}
                selected={state}
                onChange={(next) => view.set({ facets: { state: next } })}
              />
            }
          />
        }
        footer={
          list.data ? (
            <PagedFooter
              page={view.page}
              pageSize={view.pageSize}
              total={list.data.total}
              noun="organization"
              ready={!list.isFetching}
              onPage={(page) => view.set({ page })}
              onPageSize={(pageSize) => view.set({ pageSize })}
            />
          ) : null
        }
      >
        {status === 'ready' ? (
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(o) => o.id}
            onOpen={open}
            openLabel={(o) => `Open ${o.name}`}
            sort={{ key: 'created', direction: 'descending' }}
          />
        ) : (
          <DataStates
            status={status}
            pageSize={view.pageSize}
            onRetry={() => void list.refetch()}
            onReset={reset}
            query={view.query}
            thing="organizations"
            emptyTitle="No team organizations yet"
            emptyText="Provision an organization and invite its first owner. It appears here right away."
            emptyAction={provision}
          />
        )}
      </DataTableCard>
      <ProvisionDialog open={provisioning} onOpenChange={setProvisioning} />
    </DataListPage>
  );
}
