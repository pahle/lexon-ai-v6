import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  NumberedPageQuerySchema,
  facetSchema,
  numberedPageSchema,
} from '../src/numbered-page.js';

test('page defaults to 1 and pageSize to 20', () => {
  expect(NumberedPageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
});
test('pageSize accepts only 10, 20, 50', () => {
  expect(NumberedPageQuerySchema.parse({ pageSize: '20' }).pageSize).toBe(20);
  for (const pageSize of [15, 0, 100]) {
    expect(NumberedPageQuerySchema.safeParse({ pageSize }).success).toBe(false);
  }
});
test('page bounds', () => {
  for (const page of [0, 10_001, 1.5]) {
    expect(NumberedPageQuerySchema.safeParse({ page }).success).toBe(false);
  }
  expect(NumberedPageQuerySchema.safeParse({ page: '10000' }).success).toBe(
    true,
  );
});
test('facet accepts a single value or repeats and dedupes', () => {
  const facet = facetSchema(z.enum(['active', 'disabled']));
  expect(facet.parse('active')).toEqual(['active']);
  expect(facet.parse(['active', 'active', 'disabled'])).toEqual([
    'active',
    'disabled',
  ]);
  expect(facet.parse(undefined)).toBeUndefined();
  expect(facet.safeParse(['bogus']).success).toBe(false);
});
test('page schema rejects extra keys', () => {
  expect(
    numberedPageSchema(z.string()).safeParse({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      extra: 1,
    }).success,
  ).toBe(false);
});
