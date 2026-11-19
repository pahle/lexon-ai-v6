'use client';

import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { useAuiState } from '@assistant-ui/react';
import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FC } from 'react';

const VIEWPORT = '[data-slot="aui_thread-viewport"]';
const SENTINEL = '[data-slot="aui_thread-bottom-sentinel"]';

/**
 * Collapses any number of `request()` calls within one animation frame into a
 * single `write()` (F4.2 G3: one scroll write per frame, however many chunks).
 */
export function createFrameCoalescer(write: () => void) {
  let frame: number | null = null;
  return {
    request() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        write();
      });
    },
    cancel() {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    },
  };
}

/**
 * When a run starts, brings the question it answers to the top of the thread
 * (`block: 'start'`, offset by the message's scroll margin, which equals the
 * thread's top padding). The answer then streams beneath it without the page
 * following every chunk.
 */
export const ScrollOnNewRun: FC = () => {
  const running = useAuiState((state) => state.thread.isRunning);
  const marker = useRef<HTMLSpanElement>(null);
  const wasRunning = useRef(running);
  const coalescer = useRef<ReturnType<typeof createFrameCoalescer> | null>(
    null,
  );
  useEffect(() => {
    const viewport = marker.current?.closest<HTMLElement>(VIEWPORT);
    coalescer.current = createFrameCoalescer(() => {
      const users =
        viewport?.querySelectorAll<HTMLElement>('[data-role="user"]');
      users?.[users.length - 1]?.scrollIntoView?.({
        block: 'start',
        behavior: 'smooth',
      });
    });
    return () => coalescer.current?.cancel();
  }, []);
  useEffect(() => {
    if (running && !wasRunning.current) coalescer.current?.request();
    wasRunning.current = running;
  }, [running]);
  return <span ref={marker} hidden />;
};

/** The element the scroll-to-latest button watches. */
export const BottomSentinel: FC = () => (
  <div
    data-slot="aui_thread-bottom-sentinel"
    aria-hidden="true"
    className="h-px shrink-0"
  />
);

/**
 * LEX-DS-001 v3.2 §5.5: a 36px round button, centered, 12px above the top of
 * the composer box. It lives in the composer's root, whose top edge is the
 * box's top edge, so it rises as the composer grows and never covers it.
 */
export const ScrollToLatest: FC = () => {
  const anchor = useRef<HTMLSpanElement>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const viewport = anchor.current?.closest<HTMLElement>(VIEWPORT) ?? null;
    const sentinel = viewport?.querySelector<HTMLElement>(SENTINEL) ?? null;
    if (!viewport || !sentinel || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) setAway(!entry.isIntersecting);
      },
      { root: viewport },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      <TooltipIconButton
        type="button"
        tooltip="Scroll to bottom"
        variant="ghost"
        disabled={!away}
        onClick={() => {
          const viewport = anchor.current?.closest<HTMLElement>(VIEWPORT);
          viewport?.scrollTo({ top: viewport.scrollHeight });
        }}
        className="aui-thread-scroll-to-bottom bg-background text-muted-foreground hover:bg-background dark:hover:bg-background absolute bottom-full left-1/2 z-10 mb-3 size-9 -translate-x-1/2 rounded-full border-0 p-0 shadow-[0_0_0_1px_var(--border),0_6px_16px_-6px_rgba(8,6,6,.25)] disabled:invisible [&_svg]:size-[18px]"
      >
        <ChevronDownIcon />
      </TooltipIconButton>
    </>
  );
};
