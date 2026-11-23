'use client';

import type { ReactNode } from 'react';
import { DataStates } from './data-states';
import { DataTable, type DataColumn, type MobileRow } from './data-table';
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
  count,
  thing,
  mobileRow,
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
  /** The count pill; defaults to the rows shown (pass the total when paged). */
  count?: number;
  /** Completes "Loading <thing>" and "We could not load <thing>." */
  thing?: string;
  mobileRow?: (row: T) => MobileRow;
}) {
  return (
    <DataTableCard
      title={title}
      {...(description ? { description } : {})}
      {...(status === 'ready' ? { count: count ?? rows.length } : {})}
      {...(footer ? { footer } : {})}
    >
      {status === 'ready' ? (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={getRowId}
          {...(onOpen ? { onOpen } : {})}
          {...(mobileRow ? { mobileRow } : {})}
        />
      ) : status === 'empty' ? (
        // Prototype revision 16: a record card's empty state sits under a rule.
        <div className="border-border border-t">
          <DataStates
            status={status}
            pageSize={Math.max(rows.length, 3)}
            onRetry={onRetry}
            onReset={() => undefined}
            emptyText={emptyText}
            {...(thing ? { thing } : {})}
            {...(emptyTitle ? { emptyTitle } : {})}
          />
        </div>
      ) : (
        <DataStates
          status={status}
          pageSize={Math.max(rows.length, 3)}
          onRetry={onRetry}
          onReset={() => undefined}
          emptyText={emptyText}
          {...(thing ? { thing } : {})}
          {...(emptyTitle ? { emptyTitle } : {})}
        />
      )}
    </DataTableCard>
  );
}
