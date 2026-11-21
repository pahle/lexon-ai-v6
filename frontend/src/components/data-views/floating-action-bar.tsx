'use client';

import { XIcon } from 'lucide-react';
import type { ComponentType, FC } from 'react';
import { Checkbox } from '@/components/ui/checkbox';

export type BarAction = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: (ids: string[]) => void;
  destructive?: boolean;
};

const button =
  'inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 font-medium outline-none hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-background';

/** Fixed 24px (16px on mobile) above the bottom, centered on the content area; shown while rows are selected. */
export const FloatingActionBar: FC<{
  selectedIds: string[];
  actions: BarAction[];
  onClear: () => void;
}> = ({ selectedIds, actions, onClear }) => {
  if (selectedIds.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Selected rows"
      data-slot="floating-action-bar"
      className="bg-foreground text-background fixed bottom-4 left-1/2 z-15 flex max-w-[calc(100%-24px)] -translate-x-1/2 animate-in fade-in-0 slide-in-from-bottom-2 items-center gap-0.5 overflow-x-auto rounded-xl p-[5px] text-[13px] whitespace-nowrap shadow-[0_12px_32px_-10px_rgba(8,6,6,0.45)] duration-200 motion-reduce:animate-none md:bottom-6 md:left-[calc(50%+var(--sidebar-width,0px)/2)]"
    >
      <span className="inline-flex items-center gap-2 pr-2.5 pl-2 font-medium">
        <Checkbox
          checked
          disabled
          aria-hidden="true"
          tabIndex={-1}
          className="border-background bg-background text-foreground"
        />
        {selectedIds.length} selected
      </span>
      <span
        className="bg-background/25 mx-1 h-[18px] w-px"
        aria-hidden="true"
      />
      {actions.map(({ label, icon: Icon, onSelect, destructive }) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelect(selectedIds)}
          className={`${button} ${destructive ? 'text-[#F0646C]' : ''}`}
        >
          <Icon className="size-[15px]" aria-hidden="true" />
          {label}
        </button>
      ))}
      <span
        className="bg-background/25 mx-1 h-[18px] w-px"
        aria-hidden="true"
      />
      <button
        type="button"
        aria-label="Clear selection"
        onClick={onClear}
        className={`${button} px-[7px] opacity-70`}
      >
        <XIcon className="size-[15px]" aria-hidden="true" />
      </button>
    </div>
  );
};
