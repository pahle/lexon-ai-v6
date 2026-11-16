// Pure sequencing engine for the thinking indicator. No DOM, no clock, no
// ambient randomness: every random number comes through the injected Random.
// Constants come from the prototype's lqMount script
// (docs/design/f4.1-prototype/source/prototype.html, LQ_SCENES and loop).

export type MarkId =
  | 'lexon'
  | 'section'
  | 'writing'
  | 'paper'
  | 'highlighter'
  | 'column'
  | 'pilcrow';
export type PatternId = 'scatter' | 'orbit' | 'swarm' | 'spiral' | 'figure8';
export type Random = () => number; // [0, 1)

const REST_MARKS: readonly MarkId[] = [
  'section',
  'writing',
  'paper',
  'highlighter',
  'column',
  'pilcrow',
];
const PATTERNS: readonly PatternId[] = [
  'scatter',
  'orbit',
  'swarm',
  'spiral',
  'figure8',
];

// LQ_SCENES[].draw
const DRAW_MS: Record<MarkId, number> = {
  lexon: 1300,
  section: 900,
  writing: 1200,
  paper: 1000,
  highlighter: 700,
  column: 1000,
  pilcrow: 800,
};
// hold(): fillAfter 800 + 1100, accent 900 + 400, shimmer 1400, else 900
const HOLD_MS: Record<MarkId, number> = {
  lexon: 1900,
  section: 900,
  writing: 900,
  paper: 900,
  highlighter: 1300,
  column: 1400,
  pilcrow: 900,
};
const DISSOLVE_MS = 1100; // dissolve(cur, 1100)
const SETTLE_MS = 1600; // settle(): tOut = 1600 * slow
const SETTLED_DRAW_FACTOR = 1.4; // drawIn(o, Math.round(sc.draw * 1.4))
const WANDER_MIN_MS = 10000; // play(10000 + Math.random() * 4000)
const WANDER_SPAN_MS = 4000;
const SWITCH_MIN_MS = 3500; // next = 3500 + Math.random() * 1500
const SWITCH_SPAN_MS = 1500;
export const BLEND_MS = 1600; // smooth(clamp((el - blendStart) / 1600))

// finish(): the Lexon mark's own completion, and the slowed (0.8) settle.
const FINISH_COMPLETE_MS = 500;
const FINISH_FILL_LEXON_MS = 500;
const FINISH_DISSOLVE_MS = 800;
const FINISH_SETTLE_MS = Math.round(SETTLE_MS * 0.8);
const FINISH_DRAW_MS = Math.round(DRAW_MS.lexon * SETTLED_DRAW_FACTOR);
const FINISH_FILL_MS = 700;

/** mulberry32 */
export function createSeededRandom(seed: number): Random {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lexon first, then the other six once each (Fisher-Yates). */
export function shuffleRound(random: Random): readonly MarkId[] {
  const rest = [...REST_MARKS];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return ['lexon', ...rest];
}

export interface WanderPlan {
  durationMs: number;
  segments: readonly { pattern: PatternId; startMs: number }[];
}

export function planWander(random: Random): WanderPlan {
  const durationMs = WANDER_MIN_MS + random() * WANDER_SPAN_MS;
  let pattern = PATTERNS[Math.floor(random() * PATTERNS.length)]!;
  const segments: { pattern: PatternId; startMs: number }[] = [
    { pattern, startMs: 0 },
  ];
  let startMs = 0;
  for (;;) {
    const gap = SWITCH_MIN_MS + random() * SWITCH_SPAN_MS;
    // The first switch is timed from the start; later ones from the end of
    // the previous blend.
    startMs += (segments.length > 1 ? BLEND_MS : 0) + gap;
    if (startMs >= durationMs) break;
    const others = PATTERNS.filter((candidate) => candidate !== pattern);
    pattern = others[Math.floor(random() * others.length)]!;
    segments.push({ pattern, startMs });
  }
  return { durationMs, segments };
}

export type PhaseKind = 'draw' | 'hold' | 'dissolve' | 'wander' | 'settle';
export interface Phase {
  kind: PhaseKind;
  mark: MarkId;
  startMs: number;
  durationMs: number;
  wander?: WanderPlan;
}
export interface Timeline {
  phaseAt(elapsedMs: number): { phase: Phase; progress: number };
}

export function createTimeline(random: Random): Timeline {
  const phases: Phase[] = [];
  // Assigned by the first extend() before anything reads it.
  let order!: readonly MarkId[];
  let index = 0;
  let endMs = 0;

  const push = (
    kind: PhaseKind,
    mark: MarkId,
    durationMs: number,
    wander?: WanderPlan,
  ) => {
    const phase: Phase = { kind, mark, startMs: endMs, durationMs };
    if (wander) phase.wander = wander;
    phases.push(phase);
    endMs += durationMs;
  };

  // Appends one mark's phases: [settle, draw,] hold, dissolve, wander.
  const extend = () => {
    if (phases.length === 0) {
      order = shuffleRound(random);
      push('draw', 'lexon', DRAW_MS.lexon);
    } else {
      index++;
      if (index >= order.length) {
        order = shuffleRound(random);
        index = 0;
      }
      const next = order[index]!;
      push('settle', next, SETTLE_MS);
      push('draw', next, Math.round(DRAW_MS[next] * SETTLED_DRAW_FACTOR));
    }
    const mark = order[index]!;
    push('hold', mark, HOLD_MS[mark]);
    push('dissolve', mark, DISSOLVE_MS);
    const wander = planWander(random);
    push('wander', mark, wander.durationMs, wander);
  };

  return {
    phaseAt(elapsedMs) {
      const t = Math.max(0, elapsedMs);
      while (endMs <= t) extend();
      let i = 0;
      while (phases[i]!.startMs + phases[i]!.durationMs <= t) i++;
      const phase = phases[i]!;
      return { phase, progress: (t - phase.startMs) / phase.durationMs };
    },
  };
}

export type FinishStep = {
  kind: 'complete-draw' | 'dissolve' | 'settle' | 'draw' | 'fill';
  durationMs: number;
};

export function planFinish(current: {
  kind: PhaseKind;
  mark: MarkId;
}): readonly FinishStep[] {
  const gather: FinishStep[] = [
    { kind: 'settle', durationMs: FINISH_SETTLE_MS },
    { kind: 'draw', durationMs: FINISH_DRAW_MS },
    { kind: 'fill', durationMs: FINISH_FILL_MS },
  ];
  const drawing = current.kind === 'draw' || current.kind === 'hold';
  if (!drawing) return gather;
  if (current.mark === 'lexon') {
    return [
      { kind: 'complete-draw', durationMs: FINISH_COMPLETE_MS },
      { kind: 'fill', durationMs: FINISH_FILL_LEXON_MS },
    ];
  }
  return [{ kind: 'dissolve', durationMs: FINISH_DISSOLVE_MS }, ...gather];
}
