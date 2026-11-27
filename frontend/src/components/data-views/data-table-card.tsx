import { cn } from '@/lib/utils';
import type { FC, ReactNode } from 'react';
import { CountPill } from './data-list-page';

/** Card shell: optional header with count pill; slots for toolbar, table, states, footer. */
export const DataTableCard: FC<{
  title?: string;
  description?: string;
  count?: number;
  actions?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  ruled?: boolean;
  children?: ReactNode;
  className?: string;
}> = ({
  title,
  description,
  count,
  actions,
  toolbar,
  footer,
  ruled,
  children,
  className,
}) => (
  <section
    data-slot="data-table-card"
    className={cn(
      'border-border bg-background overflow-hidden rounded-[12px] border',
      className,
    )}
  >
    {title ? (
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3.5 md:px-5 md:py-4',
          ruled && 'border-border border-b',
        )}
      >
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[15px] leading-[normal] font-semibold">
            {title}
            {count !== undefined ? <CountPill>{count}</CountPill> : null}
          </h2>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-[13px] leading-normal">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
    ) : null}
    {toolbar}
    {children}
    {footer}
  </section>
);
