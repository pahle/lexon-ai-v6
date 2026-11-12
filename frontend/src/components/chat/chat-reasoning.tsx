'use client';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDownIcon, LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { MarkdownText } from './markdown-text';

export function PersistedReasoning({
  summary,
  durationMs,
  running = false,
}: {
  readonly summary: string | null;
  readonly durationMs: number | null;
  readonly running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (summary === null) {
    return running ? (
      <span
        role="status"
        className="text-muted-foreground flex items-center gap-2 text-sm"
      >
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
        Thinking…
      </span>
    ) : null;
  }
  const seconds = durationMs === null ? null : Math.round(durationMs / 1000);
  const label =
    seconds === null
      ? 'Reasoning'
      : `Thought for ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-3">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm">
        {running ? (
          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
        ) : null}
        {label}
        <ChevronDownIcon className="size-4 transition-transform motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border text-muted-foreground mt-2 border-s-2 ps-4 text-sm">
        <MarkdownText source={summary} />
      </CollapsibleContent>
    </Collapsible>
  );
}
