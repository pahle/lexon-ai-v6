'use client';

import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';

const themes = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

export function AppearanceSettings(): React.ReactElement {
  const [mounted, setMounted] = useState(false);
  const headingId = useId();
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div aria-hidden="true" className="min-h-32" />;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={headingId} className="text-lg font-medium">
        Appearance
      </legend>
      <p className="text-sm text-muted-foreground">
        Choose how Lexon looks on this device.
      </p>
      <RadioGroup
        aria-labelledby={headingId}
        value={theme ?? 'system'}
        onValueChange={(value) => setTheme(String(value))}
        className="mt-3 w-full max-w-[35.75rem] grid-cols-1 gap-4 min-[768px]:grid-cols-3"
      >
        {themes.map(({ value, label }) => {
          const id = `${headingId}-${value}`;
          return (
            <Label
              key={value}
              htmlFor={id}
              data-slot="appearance-option"
              className="flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-[var(--radius)] outline-none focus-within:ring-2 focus-within:ring-ring"
            >
              <div
                aria-hidden="true"
                data-slot="appearance-preview"
                data-theme-preview={value}
                data-selected={theme === value}
                className="flex h-24 w-full min-w-0 gap-1 overflow-hidden rounded-[var(--radius)] border border-border bg-[var(--surface)] p-1 data-[selected=true]:border-primary"
              >
                <span
                  aria-hidden="true"
                  data-preview-theme={value === 'system' ? 'light' : value}
                  className="flex w-1/4 shrink-0 flex-col gap-1 rounded-[var(--radius)] border border-border bg-[var(--surface-raised)] p-1"
                >
                  <span className="h-1.5 w-full rounded bg-muted" />
                  <span className="h-1.5 w-2/3 rounded bg-muted" />
                </span>
                <span
                  data-preview-theme={value === 'system' ? 'dark' : value}
                  className="flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius)] bg-[var(--background)] p-2"
                >
                  <span className="h-2 w-1/2 rounded bg-muted" />
                  <span className="h-1.5 w-full rounded bg-muted/70" />
                  <span className="h-1.5 w-4/5 rounded bg-muted/70" />
                </span>
              </div>
              <div className="flex min-h-8 items-center gap-2">
                <RadioGroupItem id={id} value={value} aria-label={label} />
                <span>{label}</span>
              </div>
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
