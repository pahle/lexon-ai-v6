'use client';

import { useId } from 'react';
import type {
  UseFormRegisterReturn,
  FieldError as FormError,
} from 'react-hook-form';
import { Field, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

/**
 * A labelled 36px input with a placeholder and an optional 13px hint.
 * `optional` shows a muted 13px "Optional" at the right of the label row
 * (prototype revision 16 `.field label` + `.opt`).
 */
export function PlatformField({
  label,
  registration,
  error,
  type = 'text',
  autoComplete,
  placeholder,
  hint,
  optional = false,
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
  optional?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const id = useId();
  const describedBy =
    [
      optional ? id + '-optional' : '',
      hint ? id + '-hint' : '',
      error ? id + '-error' : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <Field data-invalid={!!error} className={cn('gap-2', className)}>
      {optional ? (
        <div className="flex items-start justify-between gap-2">
          <FieldLabel
            htmlFor={id}
            className="text-sm leading-[1.21] font-medium"
          >
            {label}
          </FieldLabel>
          <span
            id={id + '-optional'}
            className="text-muted-foreground text-[13px] leading-[1.21] font-normal"
          >
            Optional
          </span>
        </div>
      ) : (
        <FieldLabel htmlFor={id} className="text-sm leading-[1.21] font-medium">
          {label}
        </FieldLabel>
      )}
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
