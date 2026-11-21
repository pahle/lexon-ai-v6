'use client';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react';
import { useEffect, type FC } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAGE_SIZES } from './data-view-params';

/** Count, Rows per page, "Page N of M", and first/previous/next/last. An out-of-range page moves to the last page. */
export const PagedFooter: FC<{
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** Contract: also resets the page to 1 in the same update. */
  onPageSize: (pageSize: number) => void;
  noun?: string;
  /** False while loading: an out-of-range page is only corrected on real data. */
  ready?: boolean;
}> = ({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  noun = 'record',
  ready = true,
}) => {
  const last = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (ready && total > 0 && page > last) onPage(last);
  }, [ready, total, page, last, onPage]);
  const nav = (
    label: string,
    target: number,
    disabled: boolean,
    Icon: typeof ChevronLeftIcon,
  ) => (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      onClick={() => onPage(target)}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
  return (
    <div
      data-slot="paged-footer"
      className="border-border text-muted-foreground flex items-center gap-4 border-t py-2.5 pr-3 pl-4 text-[13px] md:pr-4 md:pl-5"
    >
      <span className="flex-1">
        {total} {total === 1 ? noun : `${noun}s`}
      </span>
      <span className="hidden items-center gap-1.5 md:inline-flex">
        <span id="rows-per-page">Rows per page</span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            onPageSize(Number(value));
          }}
        >
          <SelectTrigger size="sm" aria-labelledby="rows-per-page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
      <span>
        Page {Math.min(page, last)} of {last}
      </span>
      <span className="inline-flex gap-1">
        {nav('First page', 1, page <= 1, ChevronsLeftIcon)}
        {nav('Previous page', page - 1, page <= 1, ChevronLeftIcon)}
        {nav('Next page', page + 1, page >= last, ChevronRightIcon)}
        {nav('Last page', last, page >= last, ChevronsRightIcon)}
      </span>
    </div>
  );
};
