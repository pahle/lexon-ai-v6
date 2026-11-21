'use client';

import type { ReactNode } from 'react';
import { DataStates } from './data-states';
import { DataTable, type DataColumn } from './data-table';
import { DataTableCard } from './data-table-card';

/** A DataTableCard with title and count inside a record page; owns no paging or filters. */
export function RelatedTable<T>({
  title,
  description,
  columns,
  rows,
  getRowId,
  status,
  onRetry,
  onOpen,
  emptyText,
  emptyTitle,
  footer,
}: {
  title: string;
  description?: string;
  columns: DataColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  status: 'loading' | 'empty' | 'error' | 'ready';
  onRetry: () => void;
  onOpen?: (row: T) => void;
  emptyText: string;
  emptyTitle?: string;
  footer?: ReactNode;
}) {
  return (
    <DataTableCard
      title={title}
      {...(description ? { description } : {})}
      {...(status === 'ready' ? { count: rows.length } : {})}
      {...(footer ? { footer } : {})}
    >
      {status === 'ready' ? (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={getRowId}
          {...(onOpen ? { onOpen } : {})}
        />
      ) : (
        <DataStates
          status={status}
          pageSize={Math.max(rows.length, 3)}
          onRetry={onRetry}
          onReset={() => undefined}
          emptyText={emptyText}
          {...(emptyTitle ? { emptyTitle } : {})}
        />
      )}
    </DataTableCard>
  );
}
