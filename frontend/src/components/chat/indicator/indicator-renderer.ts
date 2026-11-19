// DOM writer for the thinking indicator. It owns no timing and no geometry:
// phases come from indicator-sequence.ts, shapes, dot patterns, easing, and
// sample points from indicator-geometry.ts and indicator-points.ts. This file
// only maps a phase and its progress to SVG attributes, the way the
// prototype's lqMount does (docs/design/f4.1-prototype/source/prototype.html,
// lines 282-355). It never touches React state.
import {
  DOT_COUNT as K,
  MARKS,
  blend,
  clamp01,
  createDotSeeds,
  easeInOutCubic as ease,
  patternPosition,
  reseedAnchors,
  smoothstep as smooth,
  type DotSeed,
} from './indicator-geometry';
import { MARK_PATH_LENGTHS, MARK_POINTS } from './indicator-points';
import {
  BLEND_MS,
  createSeededRandom,
  createTimeline,
  planFinish,
  type FinishStep,
  type MarkId,
  type Phase,
} from './indicator-sequence';

const NS = 'http://www.w3.org/2000/svg';
const DOT_RADIUS = 0.62; // .62 * seed.rr
const WANDER_ENTRY_MS = 1300; // tIn
const DRAW_STAGGER = 0.45; // s0 = i / n * .45
const SETTLED_DRAW_FACTOR = 1.4; // drawIn(o, round(sc.draw * 1.4))
const SETTLED_SHRINK_FACTOR = 1.2; // anim(round(sc.draw * 1.2), ...)
const ACCENT_MS = 900;
const FILL_MS = 800;
const SHIMMER_PHASE_SHIFT = 0.25;
const DISSOLVE_CARRY = 0.35; // share of the settle step that finishes the un-write

type Point = readonly [number, number];

interface MarkView {
  mark: MarkId;
  g: SVGGElement;
  paths: SVGPathElement[];
  lengths: readonly number[];
  accent: SVGPathElement | null;
  accentLength: number;
  fill: number;
}

interface ActiveFinish {
  startMs: number;
  mark: MarkId;
  steps: readonly (FinishStep & { startMs: number })[];
  entered: number; // index of the last step entered, -1 before the first
  fromPos: Point[];
  fromRad: number[];
  fillFrom: number;
  stepRad: number[];
  // complete-draw: each path's dashoffset when the step was entered.
  drawFrom: number[];
  // Finish started mid-dissolve: the dissolve progress to carry on from, kept
  // through the start of the settle step. Null otherwise.
  dissolveFrom: number | null;
}

export interface Renderer {
  readonly svg: SVGSVGElement;
  /** Paints the frame at `tsMs`. Returns true once the finish has completed. */
  frame(tsMs: number): boolean;
  /** Starts the finish from whatever phase the run is in at `nowMs`. */
  requestFinish(nowMs: number): void;
}

const attr = (el: Element, name: string, value: string | number) =>
  el.setAttribute(name, String(value));
const fixed = (n: number) => n.toFixed(3);

export function createRenderer(
  svg: SVGSVGElement,
  run: { startedAtMs: number; seed: number },
): Renderer {
  const timeline = createTimeline(createSeededRandom(run.seed));
  const seeds = createDotSeeds(createSeededRandom(run.seed ^ 0x9e3779b9));
  const pos: Point[] = Array.from({ length: K }, () => [10, 10]);
  const rad: number[] = Array(K).fill(0);
  let view: MarkView | null = null;
  let pendingFinishAt: number | null = null;
  let finish: ActiveFinish | null = null;

  const dots = seeds.map((seed) => {
    const circle = document.createElementNS(NS, 'circle');
    attr(circle, 'r', '0');
    attr(circle, 'fill', 'currentColor');
    attr(circle, 'fill-opacity', (0.55 + (0.45 * seed.size) / 1.25).toFixed(2));
    svg.appendChild(circle);
    return circle;
  });

  const paint = () => {
    for (let i = 0; i < K; i++) {
      const dot = dots[i]!;
      attr(dot, 'cx', fixed(pos[i]![0]));
      attr(dot, 'cy', fixed(pos[i]![1]));
      attr(dot, 'r', fixed(Math.max(0, rad[i]!)));
    }
  };
  const fullRadius = (i: number) => DOT_RADIUS * seeds[i]!.size;

  // --- mark views (prototype `build`) -------------------------------------
  const buildView = (mark: MarkId): MarkView => {
    const def = MARKS[mark];
    const lengths = MARK_PATH_LENGTHS[mark];
    const g = document.createElementNS(NS, 'g');
    attr(g, 'fill', 'none');
    attr(g, 'stroke', 'currentColor');
    attr(g, 'stroke-linecap', 'round');
    attr(g, 'stroke-linejoin', 'round');
    attr(g, 'stroke-width', def.strokeWidth);
    if (def.fillAfter) {
      attr(g, 'fill', 'currentColor');
      attr(g, 'fill-opacity', '0');
    }
    const paths = def.paths.map((d, i) => {
      const path = document.createElementNS(NS, 'path');
      attr(path, 'd', d);
      attr(path, 'stroke-dasharray', lengths[i]!);
      attr(path, 'stroke-dashoffset', lengths[i]!);
      if (def.dim?.includes(i)) attr(path, 'stroke-opacity', '.4');
      g.appendChild(path);
      return path;
    });
    let accent: SVGPathElement | null = null;
    let accentLength = 0;
    if (def.accent) {
      // The accent repeats a path of the mark, so it has that path's length.
      accentLength = lengths[def.paths.indexOf(def.accent)]!;
      accent = document.createElementNS(NS, 'path');
      attr(accent, 'd', def.accent);
      attr(accent, 'stroke-width', '3.8');
      attr(accent, 'stroke-opacity', '.35');
      attr(accent, 'stroke-dasharray', accentLength);
      attr(accent, 'stroke-dashoffset', accentLength);
      g.appendChild(accent);
    }
    svg.insertBefore(g, dots[0]!);
    return { mark, g, paths, lengths, accent, accentLength, fill: 0 };
  };
  const dropView = () => {
    view?.g.remove();
    view = null;
  };
  const ensureView = (mark: MarkId): MarkView => {
    if (view?.mark === mark) return view;
    dropView();
    view = buildView(mark);
    return view;
  };
  const setFill = (v: MarkView, value: number) => {
    v.fill = value;
    attr(v.g, 'fill-opacity', value);
  };

  // drawIn: staggered stroke draw.
  const drawView = (v: MarkView, k: number) => {
    const n = v.paths.length;
    v.paths.forEach((path, i) => {
      const start = (i / n) * DRAW_STAGGER;
      const local = clamp01((k - start) / (1 - DRAW_STAGGER + 0.0001));
      attr(path, 'stroke-dashoffset', v.lengths[i]! * (1 - ease(local)));
    });
  };
  const completeDraw = (v: MarkView) =>
    v.paths.forEach((path) => attr(path, 'stroke-dashoffset', '0'));

  // hold: accent sweep, shimmer, or fill.
  const holdView = (v: MarkView, ms: number) => {
    completeDraw(v);
    const def = MARKS[v.mark];
    if (v.accent) {
      attr(
        v.accent,
        'stroke-dashoffset',
        v.accentLength * (1 - ease(clamp01(ms / ACCENT_MS))),
      );
    } else if (def.shimmer) {
      const k = clamp01(ms / 1400);
      def.shimmer.forEach((pathIndex, j) => {
        const phase = k * 2 - j * SHIMMER_PHASE_SHIFT;
        attr(
          v.paths[pathIndex]!,
          'stroke-opacity',
          0.35 + 0.65 * Math.max(0, Math.sin(Math.PI * clamp01(phase))),
        );
      });
    } else if (def.fillAfter) {
      setFill(v, smooth(clamp01(ms / FILL_MS)));
    }
  };

  // dissolve: the line un-writes while dots appear behind it.
  const dissolveView = (v: MarkView, k: number) => {
    const e = smooth(k);
    v.paths.forEach((path, i) =>
      attr(path, 'stroke-dashoffset', -v.lengths[i]! * e),
    );
    if (v.accent) attr(v.accent, 'opacity', 1 - e);
    MARKS[v.mark].shimmer?.forEach((i) =>
      attr(v.paths[i]!, 'stroke-opacity', '1'),
    );
    if (MARKS[v.mark].fillAfter) setFill(v, Math.max(0, 1 - e * 2));
  };
  const dissolveDots = (mark: MarkId, k: number) => {
    const points = MARK_POINTS[mark];
    for (let i = 0; i < K; i++) {
      const on = smooth(clamp01((k - (i / K) * 0.7) / 0.3));
      pos[i] = [points[i]![0], points[i]![1]];
      rad[i] = fullRadius(i) * on;
    }
  };

  // settle: dots move onto the next shape's sample points.
  const settleDots = (
    fromPos: readonly Point[],
    fromRad: readonly number[],
    mark: MarkId,
    k: number,
  ) => {
    const target = MARK_POINTS[mark];
    for (let i = 0; i < K; i++) {
      const delay = (i / K) * 0.35;
      const q = smooth(clamp01((k - delay) / (1 - delay)));
      pos[i] = blend(fromPos[i]!, target[i]!, q);
      rad[i] = fromRad[i]! + (fullRadius(i) - fromRad[i]!) * q;
    }
  };
  // The dots rest on the shape while it draws through them, then shrink.
  const settledDrawDots = (mark: MarkId, ms: number, durationMs: number) => {
    const points = MARK_POINTS[mark];
    const shrinkMs = Math.round(
      (durationMs / SETTLED_DRAW_FACTOR) * SETTLED_SHRINK_FACTOR,
    );
    const k = smooth(clamp01(ms / shrinkMs));
    for (let i = 0; i < K; i++) {
      pos[i] = [points[i]![0], points[i]![1]];
      rad[i] = fullRadius(i) * (1 - k);
    }
  };

  // wander: random patterns, blended (prototype `play`).
  const wanderSeeds = new Map<number, readonly DotSeed[]>();
  const seedsFor = (phase: Phase) => {
    let list = wanderSeeds.get(phase.startMs);
    if (!list) {
      list = reseedAnchors(
        seeds,
        createSeededRandom((run.seed + Math.round(phase.startMs)) | 0),
      );
      wanderSeeds.set(phase.startMs, list);
    }
    return list;
  };
  const wanderInto = (
    phase: Phase,
    ms: number,
    outPos: Point[],
    outRad: number[],
  ) => {
    const plan = phase.wander!;
    const list = seedsFor(phase);
    const start = MARK_POINTS[phase.mark];
    const t = ms / 1000;
    let index = 0;
    plan.segments.forEach((segment, j) => {
      if (segment.startMs <= ms) index = j;
    });
    let current = plan.segments[index]!.pattern;
    let next: typeof current | null = null;
    let mix = 0;
    if (index > 0) {
      const into = ms - plan.segments[index]!.startMs;
      if (into < BLEND_MS) {
        current = plan.segments[index - 1]!.pattern;
        next = plan.segments[index]!.pattern;
        mix = smooth(clamp01(into / BLEND_MS));
      }
    }
    for (let i = 0; i < K; i++) {
      const seed = list[i]!;
      let p = patternPosition(current, i, t, seed);
      if (next) p = blend(p, patternPosition(next, i, t, seed), mix);
      const delay = (i / K) * 0.3;
      const enter = smooth(
        clamp01((ms / WANDER_ENTRY_MS - delay) / (1 - delay)),
      );
      outPos[i] = blend(start[i]!, p, enter);
      outRad[i] =
        DOT_RADIUS * seed.size * (1 + 0.2 * Math.sin(t * 3.5 + seed.phase));
    }
  };

  const settleFrom = new Map<number, { pos: Point[]; rad: number[] }>();
  const settleStart = (phase: Phase) => {
    let from = settleFrom.get(phase.startMs);
    if (!from) {
      // The wander before this settle, at its last instant.
      const before = timeline.phaseAt(phase.startMs - 0.001).phase;
      from = { pos: pos.map(() => [10, 10]), rad: Array(K).fill(0) };
      wanderInto(before, before.durationMs, from.pos, from.rad);
      settleFrom.set(phase.startMs, from);
    }
    return from;
  };

  // --- running -----------------------------------------------------------
  const renderRunning = (elapsedMs: number) => {
    const { phase, progress } = timeline.phaseAt(elapsedMs);
    const ms = progress * phase.durationMs;
    switch (phase.kind) {
      case 'draw': {
        drawView(ensureView(phase.mark), progress);
        if (phase.startMs === 0) {
          // The first draw has no dots behind it.
          for (let i = 0; i < K; i++) rad[i] = 0;
        } else {
          settledDrawDots(phase.mark, ms, phase.durationMs);
        }
        break;
      }
      case 'hold':
        holdView(ensureView(phase.mark), ms);
        for (let i = 0; i < K; i++) rad[i] = 0;
        break;
      case 'dissolve':
        dissolveView(ensureView(phase.mark), progress);
        dissolveDots(phase.mark, progress);
        break;
      case 'wander':
        dropView();
        wanderInto(phase, ms, pos, rad);
        break;
      case 'settle': {
        dropView();
        const from = settleStart(phase);
        settleDots(from.pos, from.rad, phase.mark, progress);
        break;
      }
    }
    paint();
    return { phase, progress };
  };

  // --- finish (prototype `__lqFinish`) -----------------------------------
  const enterStep = (f: ActiveFinish, step: FinishStep) => {
    switch (step.kind) {
      case 'complete-draw':
        f.drawFrom = ensureView('lexon').paths.map((path) =>
          Number(path.getAttribute('stroke-dashoffset')),
        );
        break;
      case 'dissolve':
        ensureView(f.mark);
        break;
      case 'settle':
        if (f.dissolveFrom === null) dropView();
        f.fromPos = pos.map((p): Point => [p[0], p[1]]);
        f.fromRad = [...rad];
        break;
      case 'draw':
        ensureView('lexon');
        break;
      case 'fill':
        f.fillFrom = ensureView('lexon').fill;
        f.stepRad = [...rad];
        break;
    }
  };
  const renderStep = (f: ActiveFinish, step: FinishStep, ms: number) => {
    const k = clamp01(ms / step.durationMs);
    switch (step.kind) {
      case 'complete-draw': {
        // Continue from where the outline is; never restart it.
        const v = ensureView('lexon');
        v.paths.forEach((path, i) =>
          attr(path, 'stroke-dashoffset', f.drawFrom[i]! * (1 - ease(k))),
        );
        break;
      }
      case 'dissolve':
        dissolveView(ensureView(f.mark), k);
        dissolveDots(f.mark, k);
        break;
      case 'settle':
        settleDots(f.fromPos, f.fromRad, 'lexon', k);
        if (f.dissolveFrom !== null && view) {
          // Finish the un-write over the start of the settle, then drop it.
          const carry = clamp01(ms / (step.durationMs * DISSOLVE_CARRY));
          const progress = f.dissolveFrom + (1 - f.dissolveFrom) * carry;
          dissolveView(view, progress);
          if (carry >= 1) {
            dropView();
            f.dissolveFrom = null;
          }
        }
        break;
      case 'draw':
        drawView(ensureView('lexon'), k);
        settledDrawDots('lexon', ms, step.durationMs);
        break;
      case 'fill': {
        const v = ensureView('lexon');
        completeDraw(v);
        const e = smooth(k);
        setFill(v, Math.max(f.fillFrom, e));
        // The static mark has no outline: fade it as the fill lands so the
        // last frame equals the static mark.
        attr(v.g, 'stroke-opacity', 1 - e);
        for (let i = 0; i < K; i++) rad[i] = f.stepRad[i]! * (1 - e);
        break;
      }
    }
    if (step.kind === 'dissolve' && k >= 1) dropView();
  };
  const renderFinish = (f: ActiveFinish, tsMs: number): boolean => {
    const t = Math.max(0, tsMs - f.startMs);
    let index = f.steps.findIndex((s) => t < s.startMs + s.durationMs);
    const done = index === -1;
    if (done) index = f.steps.length - 1;
    // Leave every earlier step at its exact end before entering the next.
    while (f.entered < index) {
      if (f.entered >= 0) {
        const previous = f.steps[f.entered]!;
        renderStep(f, previous, previous.durationMs);
      }
      f.entered += 1;
      enterStep(f, f.steps[f.entered]!);
    }
    const step = f.steps[index]!;
    renderStep(f, step, done ? step.durationMs : t - step.startMs);
    paint();
    return done;
  };

  return {
    svg,
    requestFinish(nowMs) {
      if (finish || pendingFinishAt !== null) return;
      pendingFinishAt = nowMs;
    },
    frame(tsMs) {
      if (pendingFinishAt !== null && !finish) {
        const startMs = pendingFinishAt;
        const { phase, progress } = renderRunning(startMs - run.startedAtMs);
        let at = 0;
        const steps = planFinish(phase).map((step) => {
          const placed = { ...step, startMs: at };
          at += step.durationMs;
          return placed;
        });
        finish = {
          startMs,
          mark: phase.mark,
          steps,
          entered: -1,
          fromPos: [],
          fromRad: [],
          fillFrom: 0,
          stepRad: [],
          drawFrom: [],
          dissolveFrom: phase.kind === 'dissolve' ? progress : null,
        };
      }
      if (finish) return renderFinish(finish, tsMs);
      renderRunning(tsMs - run.startedAtMs);
      return false;
    },
  };
}
