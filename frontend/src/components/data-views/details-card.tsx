'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState, type FC, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DataTableCard } from './data-table-card';

export type DetailRow =
  | { label: string; value: ReactNode; copy?: false }
  | {
      label: string;
      /** Rendered as a mono id with a copy button. */
      value: string;
      copy: true;
    };

const CopyButton: FC<{ label: string; text: string }> = ({ label, text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy ${label}`}
        className="text-muted-foreground flex-none"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </Button>
      <span className="sr-only" role="status">
        {copied ? `${label} copied` : ''}
      </span>
    </>
  );
};

/** Two-column property rows; one column on mobile. */
export const DetailsCard: FC<{ title?: string; rows: DetailRow[] }> = ({
  title = 'Details',
  rows,
}) => (
  <DataTableCard title={title} ruled>
    <dl className="grid grid-cols-1 gap-x-10 px-4 pt-1 pb-2 md:grid-cols-2 md:px-5">
      {rows.map(({ label, value, copy }) => (
        <div
          key={label}
          className="border-border grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 border-t py-[11px] text-sm leading-[normal] first:border-t-0 md:grid-cols-[132px_minmax(0,1fr)] md:gap-4 md:nth-2:border-t-0"
        >
          <dt className="text-muted-foreground text-[13px]">{label}</dt>
          <dd className="flex min-w-0 items-center gap-1.5 truncate font-medium">
            {copy ? (
              <>
                <code className="truncate font-mono text-xs font-normal">
                  {value}
                </code>
                <CopyButton label={label} text={value} />
              </>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  </DataTableCard>
);
