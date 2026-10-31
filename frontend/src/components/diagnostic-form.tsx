'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '@base-ui/react/field';
import { Button } from '@base-ui/react/button';
import { DiagnosticInputSchema, type DiagnosticInput } from '@lexon/contracts';
import { createFoundationClient } from '../lib/foundation-client';
export function DiagnosticForm() {
  const [result, setResult] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DiagnosticInput>({
    resolver: zodResolver(DiagnosticInputSchema),
    defaultValues: { probeId: '' },
  });
  const submit = handleSubmit(async (input) => {
    setResult('');
    try {
      await createFoundationClient({ baseUrl: '/api' }).diagnose(input);
      setResult('Validation accepted');
    } catch (error) {
      setResult(
        error instanceof Error && error.message === 'Validation failed'
          ? 'Validation failed'
          : 'Backend unavailable',
      );
    }
  });
  return (
    <section aria-labelledby="validation-title" className="flex flex-col gap-4">
      <h2 id="validation-title">Request validation</h2>
      <p className="text-muted-foreground">
        Submit an ID to check the backend connection and request validation.
      </p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field.Root
          invalid={Boolean(errors.probeId)}
          className="flex flex-col gap-2"
        >
          <Field.Label>Probe ID</Field.Label>
          <Field.Control
            {...register('probeId')}
            aria-invalid={Boolean(errors.probeId)}
            placeholder="00000000-0000-4000-8000-000000000000"
            autoComplete="off"
            className="probe-control"
          />
          {errors.probeId && (
            <Field.Error match role="alert">
              Enter a valid UUID.
            </Field.Error>
          )}
        </Field.Root>
        <Button type="submit" disabled={isSubmitting} className="probe-button">
          {isSubmitting ? 'Validating…' : 'Validate request'}
        </Button>
        <p role="status" aria-live="polite">
          {result}
        </p>
      </form>
    </section>
  );
}
