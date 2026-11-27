'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  BriefcaseBusinessIcon,
  EyeIcon,
  FolderPlusIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react';
import type { ProjectSummary } from '@lexon/contracts';
import type { MattersApi } from '@/lib/matters-api';
import {
  DataListPage,
  PagedFooter,
  DataStates,
  DataTable,
  DataTableCard,
  DataToolbar,
  IdentityAvatar,
  IdentityCell,
  MutedCell,
  NumberCell,
  RowMenu,
  StatusBadge,
  useDataViewParams,
  type DataColumn,
  type RowMenuItem,
} from '../data-views';
import { ConfirmDialog } from '../data-views';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { formatActivityDate } from '@/lib/date-time';
import type { ChatQueryScope } from '@/lib/chat-queries';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import { NewMatterDialog } from './new-matter-dialog';

const ROLE_LABEL = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
} as const;
const ROLE_TONE = {
  owner: 'neutral',
  editor: 'neutral',
  viewer: 'inactive',
} as const;

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned by me' },
  { value: 'shared', label: 'Shared with me' },
];

export function MattersPage({
  client,
  scope,
}: {
  client: MattersApi;
  scope: ChatQueryScope;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const view = useDataViewParams(['filter']);
  const filter = (view.facets.filter?.[0] ?? 'all') as
    'all' | 'owned' | 'shared';
  const [pageSize, setPageSize] = useState(25);
  const sort = 'activity' as const;
  const list = useInfiniteQuery({
    queryKey: ['matters', scope.orgId, filter, sort, view.query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.list(
        {
          ...(view.query ? { q: view.query } : {}),
          filter,
          sort,
          limit: pageSize,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    getNextPageParam: (page) => page.pageInfo.nextCursor ?? undefined,
    retry: false,
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(view.query || filter !== 'all');
  const state = list.isPending
    ? 'loading'
    : list.isError
      ? 'error'
      : rows.length
        ? 'ready'
        : filtered
          ? 'no-results'
          : 'empty';

  const open = (row: ProjectSummary) => router.push(`/matters/${row.id}`);
  const rowMenu = (row: ProjectSummary) => (
    <RowMenu
      label={`Actions for ${row.name}`}
      items={[
        { label: 'Open matter', icon: EyeIcon, onSelect: () => open(row) },
        ...(row.myRole === 'owner'
          ? [
              {
                label: 'Delete matter',
                icon: TrashIcon,
                destructive: true,
                separatorBefore: true,
                onSelect: () => setDeleting(row),
              } satisfies RowMenuItem,
            ]
          : []),
      ]}
    />
  );

  const columns: DataColumn<ProjectSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (m) => (
        <IdentityCell
          name={m.name}
          {...(m.matterNumber ? { secondary: m.matterNumber } : {})}
          icon={<BriefcaseBusinessIcon className="size-3.5" />}
        />
      ),
    },
    {
      key: 'practiceArea',
      header: 'Practice area',
      width: '180px',
      muted: true,
      cell: (m) => m.practiceArea ?? '—',
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '180px',
      muted: true,
      cell: (m) => m.owner.name,
    },
    {
      key: 'role',
      header: 'Your role',
      width: '110px',
      cell: (m) => (
        <StatusBadge tone={ROLE_TONE[m.myRole]}>
          {ROLE_LABEL[m.myRole]}
        </StatusBadge>
      ),
    },
    {
      key: 'chats',
      header: 'Chats',
      width: '80px',
      numeric: true,
      cell: (m) => <NumberCell value={m.chatCount} />,
    },
    {
      key: 'activity',
      header: 'Last activity',
      width: '124px',
      muted: true,
      cell: (m) => formatActivityDate(m.lastActivityAt, { yesterday: true }),
    },
    {
      key: 'menu',
      header: 'Actions',
      hideHeader: true,
      width: '56px',
      cell: (m) => rowMenu(m),
    },
  ];

  const resetFilters = () => view.set({ query: '', facets: { filter: [] } });

  return (
    <DataListPage
      title="Matters"
      action={
        <Button type="button" onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" />
          New matter
        </Button>
      }
      tabs={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
      tab={filter}
      onTab={(value) =>
        view.set({ facets: { filter: value === 'all' ? [] : [value] } })
      }
    >
      <DataTableCard
        toolbar={
          <DataToolbar
            query={view.query}
            onQuery={(query) => view.set({ query })}
            onReset={resetFilters}
            hasFilters={filtered}
            placeholder="Search matters"
          />
        }
        footer={
          rows.length && !list.hasNextPage ? (
            <PagedFooter
              page={1}
              pageSize={pageSize}
              total={rows.length}
              onPage={() => undefined}
              onPageSize={setPageSize}
              noun="matter"
            />
          ) : rows.length ? (
            <div className="border-border flex items-center justify-between border-t px-4 py-2.5 md:px-5">
              <MutedCell>
                {rows.length === 1 ? '1 matter' : `${rows.length} matters`}
              </MutedCell>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? (
                  <>
                    <Spinner aria-hidden="true" />
                    <span className="sr-only">Loading more</span>
                  </>
                ) : (
                  'Load more matters'
                )}
              </Button>
            </div>
          ) : null
        }
      >
        {rows.length && !list.isError ? (
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(m) => m.id}
            onOpen={open}
            openLabel={(m) => `Open ${m.name}`}
            mobileRow={(m) => ({
              lead: (
                <IdentityAvatar
                  icon={<BriefcaseBusinessIcon className="size-3.5" />}
                />
              ),
              title: m.name,
              sub: m.matterNumber ?? m.owner.name,
              badge: (
                <StatusBadge tone={ROLE_TONE[m.myRole]}>
                  {ROLE_LABEL[m.myRole]}
                </StatusBadge>
              ),
              meta: (
                <MutedCell>
                  {[
                    m.practiceArea ?? '—',
                    m.owner.name,
                    ROLE_LABEL[m.myRole],
                  ].join(' · ')}
                </MutedCell>
              ),
              trailing: rowMenu(m),
            })}
          />
        ) : (
          <DataStates
            status={state}
            pageSize={5}
            onRetry={() => void list.refetch()}
            onReset={resetFilters}
            query={view.query}
            thing="matters"
            emptyTitle="No matters yet"
            emptyText="Create a matter to group the chats, documents and people for one client engagement."
            emptyAction={
              <Button type="button" onClick={() => setCreating(true)}>
                <FolderPlusIcon aria-hidden="true" />
                New matter
              </Button>
            }
          />
        )}
      </DataTableCard>
      <NewMatterDialog
        client={client}
        scope={scope}
        open={creating}
        onOpenChange={setCreating}
        onSaved={() =>
          void queryClient.invalidateQueries({ queryKey: ['matters'] })
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? 'this matter'}?`}
        description={`This deletes the matter and its ${deleting?.chatCount ?? 0} ${deleting?.chatCount === 1 ? 'chat' : 'chats'}. This cannot be undone.`}
        confirmLabel="Delete matter"
        icon={TrashIcon}
        destructive
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          void client.remove(target.id).then(async () => {
            setDeleting(null);
            if (isTenantScopeCurrent(queryClient, scope))
              await queryClient.invalidateQueries({
                queryKey: ['matters'],
              });
          });
        }}
      />
    </DataListPage>
  );
}
