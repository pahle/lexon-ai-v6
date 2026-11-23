'use client';

import { cn } from '@/lib/utils';
import type { FC, KeyboardEvent, ReactNode } from 'react';

export type DataTab = { value: string; label: string; count?: number };

/** Count pill used by tabs and card headers. */
export const CountPill: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="bg-muted text-muted-foreground rounded-full px-2 py-px text-xs font-medium">
    {children}
  </span>
);

export const DataTabs: FC<{
  tabs: DataTab[];
  value: string;
  onChange: (value: string) => void;
}> = ({ tabs, value, onChange }) => {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length]!;
    onChange(next.value);
    (
      event.currentTarget.parentElement?.children[tabs.indexOf(next)] as
        HTMLElement | undefined
    )?.focus();
  };
  return (
    <div role="tablist" className="border-border -mb-1 flex gap-1 border-b">
      {tabs.map((tab, index) => {
        const on = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'focus-visible:ring-ring/50 -mb-px mr-4 inline-flex h-10 cursor-pointer items-center gap-2 border-b-2 px-1 text-sm font-medium outline-none focus-visible:ring-3',
              on
                ? 'text-foreground border-foreground'
                : 'text-muted-foreground border-transparent',
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <CountPill>{tab.count}</CountPill>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

/** Page header (title, description, primary action) with optional tabs; 96px bottom space while the action bar shows. */
export const DataListPage: FC<{
  title: string;
  description?: string;
  action?: ReactNode;
  tabs?: DataTab[];
  tab?: string;
  onTab?: (value: string) => void;
  children: ReactNode;
}> = ({ title, description, action, tabs, tab, onTab, children }) => (
  <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 pt-5 pb-10 md:gap-5 md:px-6 md:pt-7 has-[[data-slot=floating-action-bar]]:pb-24">
    <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h1 className="min-w-0 font-serif text-[32px] leading-[normal] font-normal tracking-[-0.005em]">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground text-sm leading-[1.55]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex gap-2 self-start">{action}</div> : null}
    </div>
    {tabs && tab !== undefined && onTab ? (
      <DataTabs tabs={tabs} value={tab} onChange={onTab} />
    ) : null}
    {children}
  </div>
);
