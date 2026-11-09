import { describe, expect, it } from 'vitest';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';

describe('stepJobId', () => {
  it('returns the UUID v5 reference value for a run step', () => {
    expect(stepJobId('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 1)).toBe(
      '861e9175-8412-59aa-9225-70d0149f2bc9',
    );
  });

  it('changes when the step sequence changes', () => {
    expect(stepJobId('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 1)).not.toBe(
      stepJobId('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 2),
    );
  });

  it.each([-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid sequence %s',
    (sequence) => {
      expect(() =>
        stepJobId('6ba7b810-9dad-11d1-80b4-00c04fd430c8', sequence),
      ).toThrow('Invalid step job identity');
    },
  );
});
