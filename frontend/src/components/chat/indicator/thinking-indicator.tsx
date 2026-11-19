'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createRenderer, type Renderer } from './indicator-renderer';
import { forget, noteRunning, takeFinish } from './indicator-run-store';
import { LexonMark } from './lexon-mark';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const reducedMotionSnapshot = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia(REDUCED_MOTION).matches;

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/**
 * The thinking indicator: one fixed 20 px svg. While `running` it plays the
 * Lexon mark, shape and dot cycle; when `state` becomes `finished` it plays
 * the finish and ends on the static Lexon mark. One requestAnimationFrame loop
 * writes SVG attributes through a ref, so React does not re-render per frame.
 * A first render as `finished` is the static mark, unless the run store saw
 * this message running (the message was remounted mid-run).
 */
export function ThinkingIndicator({
  state,
  messageId,
  seed,
}: {
  state: 'running' | 'finished';
  messageId: string;
  seed?: number;
}) {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
  const [generatedSeed] = useState(randomSeed);
  const seedValue = seed ?? generatedSeed;
  const [playing, setPlaying] = useState(state === 'running');
  if (state === 'running' && !playing) setPlaying(true);
  const animated = !reduced && (state === 'running' || playing);

  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  // On the first commit as `finished`, ask the run store whether this message
  // was seen running (remounted at the end of a run). Runs before paint.
  const decided = useRef(false);
  useLayoutEffect(() => {
    if (decided.current) return;
    decided.current = true;
    if (state === 'running') return;
    const outcome = takeFinish(messageId);
    if (
      outcome === 'animate' &&
      !reduced &&
      document.visibilityState === 'visible'
    ) {
      setPlaying(true);
    } else {
      forget(messageId);
    }
  }, [state, messageId, reduced]);

  // The animation loop.
  useEffect(() => {
    const svg = svgRef.current;
    if (!animated || !svg) return;
    let renderer = rendererRef.current;
    if (!renderer || renderer.svg !== svg) {
      const run = noteRunning(messageId, performance.now(), seedValue);
      renderer = createRenderer(svg, run);
      rendererRef.current = renderer;
    }
    if (state === 'finished') {
      if (document.visibilityState === 'hidden') {
        // Finished while the tab is hidden: show the static mark, no replay.
        forget(messageId);
        rendererRef.current = null;
        setPlaying(false);
        return;
      }
      renderer.requestFinish(performance.now());
    }

    let handle = 0;
    const schedule = () => {
      if (handle === 0 && document.visibilityState === 'visible') {
        handle = requestAnimationFrame(tick);
      }
    };
    const cancel = () => {
      if (handle !== 0) cancelAnimationFrame(handle);
      handle = 0;
    };
    const tick = (ts: number) => {
      handle = 0;
      if (renderer.frame(ts)) {
        forget(messageId);
        rendererRef.current = null;
        setPlaying(false);
        return;
      }
      schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancel();
      else schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancel();
    };
  }, [animated, state, messageId, seedValue]);

  return (
    <span className="inline-flex size-5 shrink-0 text-primary dark:text-(--lexon-red-text)">
      {animated ? (
        <svg
          ref={svgRef}
          aria-hidden="true"
          focusable="false"
          width={20}
          height={20}
          viewBox="0 0 20 20"
        />
      ) : (
        <LexonMark />
      )}
    </span>
  );
}
