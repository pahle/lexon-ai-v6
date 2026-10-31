import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DiagnosticInputSchema,
  DiagnosticResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  PageInfoSchema,
  PaginationSchema,
  UuidSchema,
  type EventEnvelope,
  type FoundationApi,
} from '../src/index.js';

const probeId = '6da2c40c-2b9a-4d92-b52a-111cc548b389';

describe('diagnostic contracts', () => {
  it('round trips a UUID probe and accepted response', () => {
    expect(UuidSchema.parse(probeId)).toBe(probeId);
    expect(DiagnosticInputSchema.parse({ probeId })).toEqual({ probeId });
    expect(DiagnosticResponseSchema.parse({ probeId, accepted: true })).toEqual(
      {
        probeId,
        accepted: true,
      },
    );
  });

  it.each([{}, { probeId: 'bad' }, { probeId, prompt: 'unexpected content' }])(
    'rejects invalid diagnostic input: %j',
    (input) => {
      expect(DiagnosticInputSchema.safeParse(input).success).toBe(false);
    },
  );

  it('rejects an unaccepted diagnostic response', () => {
    expect(
      DiagnosticResponseSchema.safeParse({ probeId, accepted: false }).success,
    ).toBe(false);
  });

  it('validates through the Standard Schema interface', async () => {
    expect(
      await DiagnosticInputSchema['~standard'].validate({ probeId }),
    ).toEqual({
      value: { probeId },
    });
  });
});

describe('pagination conventions', () => {
  it('defaults the page size without inventing a cursor', () => {
    expect(PaginationSchema.parse({})).toEqual({ limit: 20 });
  });

  it.each([0, 101, -1, 1.5, '20'])('rejects an invalid limit: %j', (limit) => {
    expect(PaginationSchema.safeParse({ limit }).success).toBe(false);
  });

  it('supports both pagination bounds and explicit end of results', () => {
    expect(PaginationSchema.parse({ limit: 1, cursor: probeId })).toEqual({
      limit: 1,
      cursor: probeId,
    });
    expect(PaginationSchema.parse({ limit: 100 })).toEqual({ limit: 100 });
    expect(PageInfoSchema.parse({ nextCursor: null })).toEqual({
      nextCursor: null,
    });
    expect(PageInfoSchema.parse({ nextCursor: probeId })).toEqual({
      nextCursor: probeId,
    });
    expect(PageInfoSchema.safeParse({ nextCursor: 'bad' }).success).toBe(false);
  });
});

describe('response contracts', () => {
  it.each(['ok', 'unavailable'] as const)(
    'accepts health status %s',
    (status) => {
      const health = {
        status,
        version: '0.0.1',
        dependencies: { postgres: 'up', valkey: 'down' },
      };
      expect(HealthResponseSchema.parse(health)).toEqual(health);
    },
  );

  it('rejects dependency details in place of a status', () => {
    expect(
      HealthResponseSchema.safeParse({
        status: 'ok',
        version: '0.0.1',
        dependencies: { postgres: 'postgresql://secret' },
      }).success,
    ).toBe(false);
  });

  it('accepts sanitized issues and rejects arbitrary issue data', () => {
    const error = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        issues: [{ path: 'probeId', message: 'Invalid value' }],
      },
      requestId: 'request-1',
    };
    expect(ErrorResponseSchema.parse(error)).toEqual(error);
    expect(
      ErrorResponseSchema.safeParse({
        error: {
          ...error.error,
          issues: [
            { path: 'probeId', message: 'Invalid value', input: 'secret' },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('exposes versioned events and a typed API interface', () => {
    expectTypeOf<
      EventEnvelope<{ probeId: string }>['version']
    >().toEqualTypeOf<1>();
    expectTypeOf<
      Awaited<ReturnType<FoundationApi['diagnose']>>
    >().toEqualTypeOf<{ probeId: string; accepted: true }>();
  });
});
