'use client';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  TotpInputSchema,
  RecoveryCodeInputSchema,
  type TotpInput,
} from '@lexon/contracts';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../ui/input-otp';
import { Button } from '../ui/button';
import { Field, FieldLabel, FieldError, FieldGroup } from '../ui/field';
import { FormInput } from './form-input';
import { useId } from 'react';
export function AuthenticationCodeForm({
  recovery = false,
  label = 'Authenticator code',
  submitLabel = 'Verify authenticator',
  onSubmit,
}: {
  recovery?: boolean;
  label?: string;
  submitLabel?: string;
  onSubmit: (input: TotpInput) => Promise<void>;
}) {
  const id = useId();
  const form = useForm<TotpInput>({
    resolver: zodResolver(recovery ? RecoveryCodeInputSchema : TotpInputSchema),
    defaultValues: { code: '' },
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (input) => {
        try {
          await onSubmit(input);
          form.reset();
        } catch {
          form.setError('code', {
            type: 'server',
            message: 'Unable to verify this code. Please try again.',
          });
          form.setFocus('code');
        }
      })}
    >
      <FieldGroup>
        {recovery ? (
          <FormInput
            label="Recovery code"
            registration={form.register('code')}
            error={form.formState.errors.code}
          />
        ) : (
          <Controller
            name="code"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error}>
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                <InputOTP
                  {...field}
                  id={id}
                  maxLength={6}
                  pattern="^[0-9]*$"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-invalid={!!fieldState.error}
                  aria-describedby={
                    fieldState.error ? id + '-error' : undefined
                  }
                >
                  <InputOTPGroup>
                    {Array.from({ length: 6 }, (_, index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                {fieldState.error ? (
                  <FieldError id={id + '-error'}>
                    {fieldState.error.message}
                  </FieldError>
                ) : null}
              </Field>
            )}
          />
        )}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}
