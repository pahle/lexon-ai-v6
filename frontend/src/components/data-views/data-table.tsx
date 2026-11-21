'use client';

import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RowCheckbox,
  SelectAllCheckbox,
  type RowSelectionState,
} from './row-selection';

export type DataColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  width?: string;
  numeric?: boolean;
  muted?: boolean;
  sortable?: boolean;
  /** Header text is read by screen readers only (the row-menu column). */
  hideHeader?: boolean;
};

export type MobileRow = {
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
};

const MOBILE_BELOW = 640;

/** Width of the element, from its own box (not the viewport), so it works inside any layout. */
function useContainerWidth(ref: { current: HTMLElement | null }) {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0]!.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const interactive =
  'button, a, input, [role="checkbox"], [role="menuitem"], [role="menu"]';

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onOpen,
  sort,
  selection,
  mobileRow,
  rowLabel = () => 'Select row',
}: {
  columns: DataColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onOpen?: (row: T) => void;
  sort?: { key: string; direction: 'ascending' | 'descending' };
  selection?: RowSelectionState;
  /** Mobile list item; defaults to the first column as title and the rest as meta. */
  mobileRow?: (row: T) => MobileRow;
  rowLabel?: (row: T) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);
  const mobile = width !== null && width < MOBILE_BELOW;
  const open = (row: T) => (event: MouseEvent) => {
    if (onOpen && !(event.target as HTMLElement).closest(interactive))
      onOpen(row);
  };
  const pageIds = rows.map(getRowId);

  return (
    <div ref={ref} data-slot="data-table">
      {mobile ? (
        <ul role="list" className="border-border border-t">
          {rows.map((row) => {
            const id = getRowId(row);
            const m: MobileRow = mobileRow
              ? mobileRow(row)
              : {
                  title: columns[0]!.cell(row),
                  meta: columns
                    .slice(1)
                    .map((c) => <span key={c.key}>{c.cell(row)}</span>),
                };
            return (
              <li
                key={id}
                data-slot="data-mobile-row"
                data-state={
                  selection?.selectedIds.has(id) ? 'selected' : undefined
                }
                onClick={open(row)}
                className={cn(
                  'border-border flex items-start gap-3 border-b py-3 pr-2 pl-4 last:border-b-0 data-[state=selected]:bg-muted/70',
                  onOpen && 'cursor-pointer',
                )}
              >
                {selection ? (
                  <span className="pt-2">
                    <RowCheckbox
                      id={id}
                      label={rowLabel(row)}
                      selection={selection}
                    />
                  </span>
                ) : null}
                {m.lead}
                <span className="flex min-w-0 flex-1 flex-col gap-[3px] text-[13px] leading-[1.3]">
                  <b className="truncate text-sm font-medium">{m.title}</b>
                  {m.sub ? (
                    <small className="text-muted-foreground truncate text-xs">
                      {m.sub}
                    </small>
                  ) : null}
                  {m.badge ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {m.badge}
                    </span>
                  ) : null}
                  {m.meta ? (
                    <span className="text-muted-foreground flex flex-wrap items-center gap-1.5">
                      {m.meta}
                    </span>
                  ) : null}
                </span>
                {m.trailing}
              </li>
            );
          })}
        </ul>
      ) : (
        <Table className="table-fixed border-collapse text-sm">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {selection ? (
                <TableHead
                  scope="col"
                  className="bg-muted border-border w-[52px] border-y pr-0 pl-5"
                >
                  <span className="sr-only">Selection</span>
                  <SelectAllCheckbox pageIds={pageIds} selection={selection} />
                </TableHead>
              ) : null}
              {columns.map((column, index) => {
                const sorted =
                  sort?.key === column.key ? sort.direction : undefined;
                return (
                  <TableHead
                    key={column.key}
                    scope="col"
                    aria-sort={sorted}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      'bg-muted text-muted-foreground border-border h-10 border-y px-3 text-[13px]',
                      !selection && index === 0 && 'pl-5',
                      index === columns.length - 1 && 'pr-4',
                      column.numeric && 'text-right',
                    )}
                  >
                    {column.hideHeader ? (
                      <span className="sr-only">{column.header}</span>
                    ) : sorted ? (
                      <span className="text-foreground inline-flex items-center gap-1">
                        {column.header}
                        {sorted === 'descending' ? (
                          <ArrowDownIcon
                            className="text-muted-foreground size-3.5"
                            aria-hidden="true"
                          />
                        ) : (
                          <ArrowUpIcon
                            className="text-muted-foreground size-3.5"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const id = getRowId(row);
              return (
                <TableRow
                  key={id}
                  data-state={
                    selection?.selectedIds.has(id) ? 'selected' : undefined
                  }
                  onClick={open(row)}
                  className={cn(
                    'data-[state=selected]:bg-muted/70',
                    onOpen && 'cursor-pointer',
                  )}
                >
                  {selection ? (
                    <TableCell className="w-[52px] pr-0 pl-5">
                      <RowCheckbox
                        id={id}
                        label={rowLabel(row)}
                        selection={selection}
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((column, index) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        'h-12 truncate px-3 py-1.5',
                        !selection && index === 0 && 'pl-5',
                        index === columns.length - 1 && 'pr-4',
                        column.numeric && 'text-right tabular-nums',
                        column.muted && 'text-muted-foreground',
                      )}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
