import { describe, expect, it } from 'vitest';
import {
  createSeededRandom,
  createTimeline,
} from '@/components/chat/indicator/indicator-sequence';
import fixture from './fixtures/indicator-capture-times.json';

// The brand-visual e2e spec (backend/test/e2e/brand-visual.spec.ts) reads this
// fixture instead of importing the frontend. This guard keeps the copied
// times and timeline steps equal to the real seeded timeline.
describe('indicator capture times fixture', () => {
  const timeline = createTimeline(createSeededRandom(fixture.seed));

  it('mirrors every timeline step up to the second mark hold', () => {
    fixture.steps.forEach((step) => {
      const { phase } = timeline.phaseAt(step.startMs + 1);
      expect(phase.kind).toBe(step.kind);
      expect(phase.mark).toBe(step.mark);
      expect(phase.startMs).toBeCloseTo(step.startMs, 6);
      expect(phase.durationMs).toBeCloseTo(step.durationMs, 6);
    });
    // No step is skipped: each starts where the previous one ends.
    fixture.steps.slice(1).forEach((step, index) => {
      const previous = fixture.steps[index]!;
      expect(step.startMs).toBeCloseTo(previous.startMs + previous.durationMs);
    });
  });

  it('puts indicator-mark at the start of the round second mark hold', () => {
    const last = fixture.steps.at(-1)!;
    expect(last.kind).toBe('hold');
    expect(last.mark).not.toBe('lexon');
    // The fixture time is the hold start rounded to a whole millisecond.
    expect(fixture.markMs).toBe(Math.round(last.startMs));
    expect(timeline.phaseAt(fixture.markMs + 1).phase).toMatchObject({
      kind: 'hold',
      mark: last.mark,
      startMs: expect.closeTo(fixture.markMs, 0),
    });
  });

  it('captures thinking and wander inside the phases they name', () => {
    expect(timeline.phaseAt(fixture.thinkingMs).phase).toMatchObject({
      kind: 'hold',
      mark: 'lexon',
    });
    expect(timeline.phaseAt(fixture.wanderMs).phase).toMatchObject({
      kind: 'wander',
      mark: 'lexon',
    });
  });
});
