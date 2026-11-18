'use client';

import { useId } from 'react';
import type {
  UseFormRegisterReturn,
  FieldError as FormError,
} from 'react-hook-form';
import { Field, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

/** A labelled 36px input with a placeholder and an optional 13px hint. */
export function PlatformField({
  label,
  registration,
  error,
  type = 'text',
  autoComplete,
  placeholder,
  hint,
  disabled = false,
  className,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: FormError | undefined;
  type?: string | undefined;
  autoComplete?: string | undefined;
  placeholder?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const id = useId();
  const describedBy =
    [hint ? id + '-hint' : '', error ? id + '-error' : '']
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <Field data-invalid={!!error} className={cn('gap-2', className)}>
      <FieldLabel htmlFor={id} className="text-sm leading-[1.21] font-medium">
        {label}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        {...registration}
      />
      {hint ? (
        <p
          id={id + '-hint'}
          className="text-[13px] leading-[1.21] text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
      {error ? (
        <FieldError id={id + '-error'}>{error.message}</FieldError>
      ) : null}
    </Field>
  );
}
