import { expect, it } from 'vitest';
import { EmailAddressSchema, normalizeEmail } from '../src/index.js';

it('normalises an email by trimming and lower-casing it', () => {
  expect(normalizeEmail('  Person@Example.TEST\n')).toBe('person@example.test');
  expect(normalizeEmail('person@example.test')).toBe('person@example.test');
});

it('EmailAddressSchema returns the normalised address', () => {
  expect(EmailAddressSchema.parse(' Person@Example.TEST ')).toBe(
    normalizeEmail(' Person@Example.TEST '),
  );
});
