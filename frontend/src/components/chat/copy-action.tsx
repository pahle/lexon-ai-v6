'use client';

import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { CheckIcon, CircleAlertIcon, CopyIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FC } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

const COPIED_MS = 3_000;

/**
 * Copy button with a visible failure state (LEX-DS-001 v3.2 §5.5 Action row).
 * A failed write shows the alert icon in the normal icon color; the next
 * click tries again.
 */
export const CopyAction: FC<{
  /** "answer" or "message": the idle accessible name is "Copy <label>". */
  label: string;
  getText: () => string | undefined;
  className: string;
  /** Extra classes while copied (the red-text pressed state). */
  copiedClassName?: string;
  /** The first button of the row: its tooltip aligns left on mobile. */
  first?: boolean;
  iconClassName?: string;
}> = ({ label, getText, className, copiedClassName, first, iconClassName }) => {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mobile = useIsMobile();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    const text = getText();
    if (!text) return;
    clearTimeout(timer.current);
    const write = navigator.clipboard
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error('Clipboard API is unavailable'));
    Promise.resolve(write).then(
      () => {
        setState('copied');
        timer.current = setTimeout(() => setState('idle'), COPIED_MS);
      },
      () => setState('failed'),
    );
  };

  const tooltip =
    state === 'copied'
      ? 'Copied'
      : state === 'failed'
        ? 'Could not copy'
        : 'Copy';
  const ariaLabel =
    state === 'copied'
      ? 'Copied'
      : state === 'failed'
        ? 'Could not copy. Try again'
        : `Copy ${label}`;
  const Icon =
    state === 'copied'
      ? CheckIcon
      : state === 'failed'
        ? CircleAlertIcon
        : CopyIcon;

  return (
    <TooltipIconButton
      type="button"
      tooltip={tooltip}
      side="top"
      sideOffset={6}
      align={first && mobile ? 'start' : 'center'}
      className={cn(className, state === 'copied' && copiedClassName)}
      aria-label={ariaLabel}
      {...(state === 'copied' ? { 'data-copied': 'true' } : {})}
      onClick={copy}
    >
      <Icon className={iconClassName} />
    </TooltipIconButton>
  );
};
