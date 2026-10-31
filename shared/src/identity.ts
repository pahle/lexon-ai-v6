import { z } from 'zod';

export const UuidSchema = z.uuid();
export type Uuid = z.infer<typeof UuidSchema>;
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(100, 'Use at most 100 characters.');
export const EmailAddressSchema = z
  .string()
  .trim()
  .pipe(z.email({ error: 'Enter a valid email address.' }))
  .transform((value) => value.toLowerCase());
