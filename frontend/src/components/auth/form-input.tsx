'use client';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type {
  UseFormRegisterReturn,
  FieldError as FormError,
} from 'react-hook-form';
import { cn } from 'cn';
import { authInputClass } from './auth-parts';
import { Field, FieldLabel, FieldError } from '../ui/field';
import { Input } from '../ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '../ui/input-group';
export function FormInput({
  label,
  labelAside,
  registration,
  error,
  type = 'text',
  autoComplete,
  disabled = false,
  placeholder,
  hint,
  readOnly = false,
}: {
  label: string;
  labelAside?: ReactNode;
  registration: UseFormRegisterReturn;
  error?: FormError | undefined;
  type?: string | undefined;
  autoComplete?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  hint?: string | undefined;
  readOnly?: boolean | undefined;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const invalid = !!error;
  const inputProps = {
    id,
    type: type === 'password' && visible ? 'text' : type,
    autoComplete,
    disabled,
    placeholder,
    readOnly,
    'aria-invalid': invalid,
    'aria-describedby': error ? id + '-error' : undefined,
    ...registration,
  };
  return (
    <Field data-invalid={!!error}>
      {labelAside ? (
        <div className="flex h-[17px] items-center">
          <FieldLabel htmlFor={id} className="leading-[1.21]">
            {label}
          </FieldLabel>
          {labelAside}
        </div>
      ) : (
        <FieldLabel htmlFor={id} className="leading-[1.21]">
          {label}
        </FieldLabel>
      )}
      {type === 'password' ? (
        <InputGroup
          className={cn(
            authInputClass,
            'h-11 px-0 has-disabled:opacity-60 has-[[data-slot][aria-invalid=true]]:border-lexon-red-text has-[[data-slot][aria-invalid=true]]:ring-0 has-disabled:bg-background dark:has-disabled:bg-background',
          )}
        >
          <InputGroupInput
            {...inputProps}
            className="h-full px-3.5 text-[15px] disabled:opacity-100 md:text-[15px]"
          />
          <InputGroupAddon align="inline-end" className="pr-1.5">
            <InputGroupButton
              aria-label={visible ? 'Hide password' : 'Show password'}
              aria-pressed={visible}
              disabled={disabled}
              onClick={() => setVisible((value) => !value)}
              size="icon-sm"
            >
              {visible ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Input {...inputProps} className={authInputClass} />
      )}
      {hint && !error ? (
        <span className="text-[13px] leading-4 text-muted-foreground">
          {hint}
        </span>
      ) : null}
      {error ? (
        <FieldError
          id={id + '-error'}
          className="text-[13px] leading-4 text-lexon-red-text"
        >
          {error.message}
        </FieldError>
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
