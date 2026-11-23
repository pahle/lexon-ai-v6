'use client';

import type { FC } from 'react';
import { Checkbox } from '@/components/ui/checkbox';

export type RowSelectionState = {
  selectedIds: ReadonlySet<string>;
  onSelectedIdsChange: (ids: ReadonlySet<string>) => void;
};

/** Header checkbox: selects or clears every row on the current page. */
export const SelectAllCheckbox: FC<{
  pageIds: string[];
  selection: RowSelectionState;
}> = ({ pageIds, selection }) => {
  const count = pageIds.filter((id) => selection.selectedIds.has(id)).length;
  const all = pageIds.length > 0 && count === pageIds.length;
  return (
    <Checkbox
      aria-label="Select all rows on this page"
      checked={all}
      indeterminate={count > 0 && !all}
      onCheckedChange={(on) => {
        const next = new Set(selection.selectedIds);
        for (const id of pageIds) {
          if (on) next.add(id);
          else next.delete(id);
        }
        selection.onSelectedIdsChange(next);
      }}
    />
  );
};

export const RowCheckbox: FC<{
  id: string;
  label: string;
  selection: RowSelectionState;
}> = ({ id, label, selection }) => (
  <Checkbox
    aria-label={label}
    checked={selection.selectedIds.has(id)}
    onCheckedChange={(on) => {
      const next = new Set(selection.selectedIds);
      if (on) next.add(id);
      else next.delete(id);
      selection.onSelectedIdsChange(next);
    }}
  />
);
