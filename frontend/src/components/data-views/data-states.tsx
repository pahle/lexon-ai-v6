'use client';

import { InboxIcon, SearchIcon, XIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { ListFailure } from '@/components/states/list-failure';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

const widths = [58, 44, 64, 50, 40];

/** The state of a data list, rendered inside its card. A failure is never an empty state. */
export const DataStates: FC<{
  status: 'loading' | 'empty' | 'no-results' | 'error' | 'ready';
  pageSize: number;
  onRetry: () => void;
  onReset: () => void;
  emptyText: string;
  emptyTitle?: string;
  emptyAction?: ReactNode;
  query?: string;
  thing?: string;
}> = ({
  status,
  pageSize,
  onRetry,
  onReset,
  emptyText,
  emptyTitle = 'Nothing here yet',
  emptyAction,
  query,
  thing = 'records',
}) => {
  if (status === 'ready') return null;
  if (status === 'loading')
    return (
      <div role="status" aria-busy="true" aria-label={`Loading ${thing}`}>
        {Array.from({ length: pageSize }, (_, index) => (
          <div
            key={index}
            data-slot="data-skeleton-row"
            className="border-border flex h-12 items-center gap-6 border-b px-5 last:border-b-0"
          >
            {[0, 1, 2].map((cell) => (
              <Skeleton
                key={cell}
                className="h-3.5"
                style={{ width: `${widths[(index + cell) % widths.length]}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  if (status === 'error')
    return (
      <div className="px-4 pt-4 pb-5 md:px-5">
        <ListFailure thing={thing} onRetry={onRetry} />
      </div>
    );
  const noResults = status === 'no-results';
  const Icon = noResults ? SearchIcon : InboxIcon;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          {noResults
            ? query
              ? `No ${thing} match “${query}”`
              : `No ${thing} match these filters`
            : emptyTitle}
        </EmptyTitle>
        <EmptyDescription>
          {noResults ? 'Try other words or reset the filters.' : emptyText}
        </EmptyDescription>
      </EmptyHeader>
      {noResults ? (
        <EmptyContent>
          <Button type="button" variant="outline" onClick={onReset}>
            <XIcon className="size-3.5" aria-hidden="true" />
            Reset filters
          </Button>
        </EmptyContent>
      ) : emptyAction ? (
        <EmptyContent>{emptyAction}</EmptyContent>
      ) : null}
    </Empty>
  );
};
