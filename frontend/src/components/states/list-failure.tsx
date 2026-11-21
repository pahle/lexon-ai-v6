'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CircleAlertIcon, RefreshCwIcon } from 'lucide-react';
import type { FC } from 'react';

/**
 * A list whose request failed (LEX-DS-001 v3.2 §5.1, §5.5 Error row): what
 * failed, and Try again. Never an Empty state.
 */
export const ListFailure: FC<{
  /** Completes "We could not load <thing>." */
  thing: string;
  onRetry: () => void;
  className?: string;
}> = ({ thing, onRetry, className }) => (
  <div
    role="alert"
    data-slot="list-failure"
    className={cn(
      'bg-muted border-border flex items-center gap-3 rounded-xl border py-2.5 pr-2.5 pl-3.5 text-[15px]',
      className,
    )}
  >
    <CircleAlertIcon
      className="text-muted-foreground size-[18px] shrink-0"
      aria-hidden="true"
    />
    <span className="flex-1">We could not load {thing}.</span>
    <Button
      type="button"
      variant="outline"
      className="shrink-0"
      onClick={onRetry}
    >
      <RefreshCwIcon className="size-3.5" aria-hidden="true" />
      Try again
    </Button>
  </div>
);

/** The sidebar form: one muted line and an underlined text button. */
export const InlineListFailure: FC<{
  thing: string;
  onRetry: () => void;
}> = ({ thing, onRetry }) => (
  <p
    role="alert"
    data-slot="inline-list-failure"
    className="text-muted-foreground px-2 py-1 text-[13px] leading-[1.5]"
  >
    We could not load {thing}.{' '}
    <button
      type="button"
      onClick={onRetry}
      className="text-foreground cursor-pointer font-medium underline underline-offset-2"
    >
      Try again
    </button>
  </p>
);
