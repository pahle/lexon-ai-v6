'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { usePanelHost } from './workspace-shell';
import { useIsMobile } from '../../hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';
import { Button } from '../ui/button';

type RightPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  triggerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
};

export function RightPanel({
  open,
  onOpenChange,
  title,
  triggerRef,
  children,
}: RightPanelProps): React.ReactElement | null {
  const host = usePanelHost();
  const isMobile = useIsMobile();
  const titleId = React.useId();
  const mobileInitialFocus = React.useRef<HTMLDivElement>(null);
  const finalFocus = React.useCallback(() => {
    const opener = triggerRef.current;
    if (opener?.isConnected) return opener;
    return document.querySelector<HTMLElement>('main[tabindex="-1"]');
  }, [triggerRef]);

  React.useEffect(() => {
    if (!open || !isMobile) return;
    // On a desktop-to-mobile switch, Base UI sees an already-open dialog and
    // skips its open transition focus. Apply the mobile initial target after
    // the primitive finishes mounting its modal focus guards.
    const focusTimer = window.setTimeout(
      () => mobileInitialFocus.current?.focus(),
      0,
    );
    return () => window.clearTimeout(focusTimer);
  }, [isMobile, open]);

  if (!open) return null;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          aria-labelledby={titleId}
          initialFocus={mobileInitialFocus}
          finalFocus={finalFocus}
          side="right"
          className="!w-screen !max-w-none"
        >
          <SheetHeader ref={mobileInitialFocus} tabIndex={-1}>
            <SheetTitle id={titleId}>{title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  if (!host) return null;

  return createPortal(
    <aside
      aria-label={title}
      aria-labelledby={titleId}
      className="flex min-h-0 w-[var(--right-panel-width)] shrink-0 flex-col border-l border-border bg-surface-raised"
      style={{ width: 'var(--right-panel-width)' }}
    >
      <header className="flex min-h-14 items-center justify-between gap-2 border-b border-border px-4">
        <h2
          id={titleId}
          className="min-w-0 text-base font-medium text-foreground"
        >
          {title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-11 shrink-0"
          aria-label="Close panel"
          onClick={() => onOpenChange(false)}
        >
          <span aria-hidden="true">×</span>
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>,
    host,
  );
}
