import { z } from 'zod';
import { UuidSchema, EmailAddressSchema } from './identity.js';

export const NewPasswordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use at most 128 characters.');
export const ExistingPasswordSchema = z
  .string()
  .min(1, 'Enter your password.')
  .max(128);
export const FlowTokenSchema = z.string().min(1).max(4096);
const totp = z.string().regex(/^[0-9]{6}$/, 'Enter the six-digit code.');
const recovery = z.string().trim().min(1, 'Enter a recovery code.').max(128);
export const TotpInputSchema = z.strictObject({ code: totp });
export type TotpInput = z.infer<typeof TotpInputSchema>;
export const RecoveryCodeInputSchema = z.strictObject({ code: recovery });
export type RecoveryCodeInput = z.infer<typeof RecoveryCodeInputSchema>;
export const ReauthenticateInputSchema = z
  .strictObject({
    password: ExistingPasswordSchema,
    totp: totp.optional(),
    recoveryCode: recovery.optional(),
  })
  .refine((input) => !(input.totp && input.recoveryCode), {
    message: 'Use one authentication code.',
  });
export type ReauthenticateInput = z.infer<typeof ReauthenticateInputSchema>;
export const PasswordChangeInputSchema = z.strictObject({
  currentPassword: ExistingPasswordSchema,
  newPassword: NewPasswordSchema,
});
export type PasswordChangeInput = z.infer<typeof PasswordChangeInputSchema>;
export const PasswordResetInputSchema = z.strictObject({
  token: FlowTokenSchema,
  newPassword: NewPasswordSchema,
});
export type PasswordResetInput = z.infer<typeof PasswordResetInputSchema>;
export const PasswordResetRequestInputSchema = z.strictObject({
  email: EmailAddressSchema,
});
export type PasswordResetRequestInput = z.infer<
  typeof PasswordResetRequestInputSchema
>;
export const EmailChangeInputSchema = z.strictObject({
  newEmail: EmailAddressSchema,
});
export type EmailChangeInput = z.infer<typeof EmailChangeInputSchema>;
export const OwnSessionSummarySchema = z.strictObject({
  version: z.literal(1),
  id: UuidSchema,
  channel: z.enum(['cookie', 'bearer']),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  current: z.boolean(),
});
export type OwnSessionSummary = z.infer<typeof OwnSessionSummarySchema>;
export const SecurityStateSchema = z.strictObject({
  version: z.literal(1),
  twoFactorEnabled: z.boolean(),
  mfaVerified: z.boolean(),
  reauthenticationExpiresAt: z.iso.datetime().nullable(),
  recoveryCodesRemaining: z.number().int().min(0),
});
export type SecurityState = z.infer<typeof SecurityStateSchema>;
export const BearerSessionResponseSchema = z.strictObject({
  version: z.literal(1),
  token: FlowTokenSchema,
  sessionId: UuidSchema,
  expiresAt: z.iso.datetime(),
});
export type BearerSessionResponse = z.infer<typeof BearerSessionResponseSchema>;
// Separate from the web API: the browser client never issues or holds Bearer tokens.
export interface BearerSessionApi {
  issueBearer(): Promise<BearerSessionResponse>;
}
