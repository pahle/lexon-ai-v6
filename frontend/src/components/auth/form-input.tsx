'use client';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type {
  UseFormRegisterReturn,
  FieldError as FormError,
} from 'react-hook-form';
import { Field, FieldLabel, FieldError } from '../ui/field';
import { Input } from '../ui/input';
import {
  InputGroup,
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
}: {
  label: string;
  labelAside?: ReactNode;
  registration: UseFormRegisterReturn;
  error?: FormError | undefined;
  type?: string | undefined;
  autoComplete?: string | undefined;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const invalid = !!error;
  const inputProps = {
    id,
    type: type === 'password' && visible ? 'text' : type,
    autoComplete,
    'aria-invalid': invalid,
    'aria-describedby': error ? id + '-error' : undefined,
    ...registration,
  };
  return (
    <Field data-invalid={!!error}>
      {labelAside ? (
        <div className="flex items-center">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {labelAside}
        </div>
      ) : (
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
      )}
      {type === 'password' ? (
        <InputGroup>
          <InputGroupInput {...inputProps} />
          <InputGroupButton
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            onClick={() => setVisible((value) => !value)}
            size="icon-xs"
          >
            {visible ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroup>
      ) : (
        <Input {...inputProps} />
      )}
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
