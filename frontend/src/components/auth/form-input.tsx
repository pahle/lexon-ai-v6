'use client';
import { useId } from 'react';
import type {
  UseFormRegisterReturn,
  FieldError as FormError,
} from 'react-hook-form';
import { Field, FieldLabel, FieldError } from '../ui/field';
import { Input } from '../ui/input';
export function FormInput({
  label,
  registration,
  error,
  type = 'text',
  autoComplete,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: FormError | undefined;
  type?: string | undefined;
  autoComplete?: string | undefined;
}) {
  const id = useId();
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={!!error}
        aria-describedby={error ? id + '-error' : undefined}
        {...registration}
      />
      {error ? (
        <FieldError id={id + '-error'}>{error.message}</FieldError>
      ) : null}
    </Field>
  );
}
export function authFailure(
  error?: { status?: number | undefined; code?: string | undefined } | null,
) {
  return error?.status === 503 || error?.status === 0
    ? 'Service temporarily unavailable. Please try again.'
    : error?.status === 429
      ? 'Too many attempts. Please try again later.'
      : 'Unable to complete the request. Check your details or try again.';
}
