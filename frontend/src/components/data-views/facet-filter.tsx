'use client';

import { CirclePlusIcon, XIcon } from 'lucide-react';
import { useRef, type FC } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type FacetOption = { value: string; label: string };

/** Dashed facet button, selected chips, and a 220px checkbox list with Clear filter. */
export const FacetFilter: FC<{
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
  const chips = options.filter((o) => selected.includes(o.value));
  // Toggles build on the last choice, not on `selected`: the URL behind it
  // updates in a transition, so a second click can come before it does.
  const key = selected.join('\u0000');
  const pending = useRef(selected);
  const seen = useRef(key);
  if (seen.current !== key) {
    seen.current = key;
    pending.current = selected;
  }
  const change = (next: string[]) => {
    pending.current = next;
    onChange(next);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // With chips the visible text names the button (WCAG 2.5.3), so a
        // fixed label would drop the selection from its accessible name.
        {...(chips.length ? {} : { 'aria-label': label })}
        className="border-input focus-visible:ring-ring/50 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3 text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-3"
      >
        <CirclePlusIcon
          className="text-muted-foreground size-[15px]"
          aria-hidden="true"
        />
        {label}
        {chips.length ? (
          <>
            <span className="bg-border mx-0.5 h-4 w-px" aria-hidden="true" />
            {chips.map((chip) => (
              <span
                key={chip.value}
                className="bg-muted inline-flex h-5 items-center rounded px-1.5 text-xs font-medium"
              >
                {chip.label}
              </span>
            ))}
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[220px]">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            closeOnClick={false}
            onCheckedChange={(on) =>
              change(
                on
                  ? [
                      ...pending.current.filter((v) => v !== option.value),
                      option.value,
                    ]
                  : pending.current.filter((v) => v !== option.value),
              )
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-muted-foreground justify-center"
              onClick={() => change([])}
            >
              <XIcon aria-hidden="true" />
              Clear filter
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
