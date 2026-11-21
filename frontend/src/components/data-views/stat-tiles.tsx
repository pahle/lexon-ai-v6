import type { ComponentType, FC } from 'react';

export type StatTile = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  supporting?: string;
};

const columns = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
} as const;

/** Two to four tiles; one column of compact rows on mobile. */
export const StatTiles: FC<{ items: StatTile[] }> = ({ items }) => (
  <div
    className={`grid grid-cols-1 gap-2 md:gap-3 ${columns[Math.min(4, Math.max(2, items.length)) as 2 | 3 | 4]}`}
  >
    {items.map(({ icon: Icon, label, value, supporting }) => (
      <div
        key={label}
        data-slot="stat-tile"
        className="border-border bg-background grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl border px-3.5 py-3 md:flex md:flex-col md:items-stretch md:gap-1.5 md:px-4 md:py-3.5"
      >
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </span>
        <b className="col-start-2 row-span-2 row-start-1 truncate text-right text-lg leading-tight font-semibold tabular-nums md:text-[22px] md:text-left">
          {value}
        </b>
        {supporting ? (
          <small className="text-muted-foreground text-xs md:-mt-0.5">
            {supporting}
          </small>
        ) : null}
      </div>
    ))}
  </div>
);
