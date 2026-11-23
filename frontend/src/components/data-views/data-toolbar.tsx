'use client';

import { SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';

/**
 * Debounced search (nothing is sent under `minLength` characters, except
 * clearing the box), facet slots, Reset, and right-side tools.
 */
export const DataToolbar: FC<{
  query: string;
  onQuery: (query: string) => void;
  onReset: () => void;
  facets?: ReactNode;
  hasFilters?: boolean;
  right?: ReactNode;
  placeholder?: string;
  minLength?: number;
  debounceMs?: number;
}> = ({
  query,
  onQuery,
  onReset,
  facets,
  hasFilters,
  right,
  placeholder = 'Search',
  minLength = 2,
  debounceMs = 300,
}) => {
  const [text, setText] = useState(query);
  const sent = useRef(query);
  const latest = useRef(onQuery);
  useEffect(() => {
    latest.current = onQuery;
  });
  // Follow the URL when it changes elsewhere (Reset, back/forward).
  useEffect(() => {
    sent.current = query;
    setText(query);
  }, [query]);
  useEffect(() => {
    const value = text.trim();
    if (value === sent.current || (value !== '' && value.length < minLength))
      return;
    const timer = setTimeout(() => {
      sent.current = value;
      latest.current(value);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [text, minLength, debounceMs]);
  return (
    <div
      data-slot="data-toolbar"
      className="flex flex-wrap items-center gap-2 px-4 py-3 md:px-5 md:py-3.5"
    >
      <InputGroup className="h-9 w-full md:w-[280px]">
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </InputGroup>
      {facets}
      {query || hasFilters ? (
        <button
          type="button"
          onClick={() => {
            setText('');
            onReset();
          }}
          className="text-muted-foreground focus-visible:ring-ring/50 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium outline-none focus-visible:ring-3"
        >
          <XIcon className="size-3.5" aria-hidden="true" />
          Reset
        </button>
      ) : null}
      <span className="hidden flex-1 md:block" />
      {right}
    </div>
  );
};
