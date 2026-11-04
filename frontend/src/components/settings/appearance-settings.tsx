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
        className="mt-3 grid grid-cols-1 gap-4 min-[768px]:grid-cols-3"
      >
        {themes.map(({ value, label }) => {
          const id = `${headingId}-${value}`;
          return (
            <Label
              key={value}
              htmlFor={id}
              className="flex w-full max-w-[11.25rem] cursor-pointer flex-col gap-2 rounded-[var(--radius)] border border-border bg-[var(--surface-raised)] p-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <div
                aria-hidden="true"
                data-slot="appearance-preview"
                data-theme-preview={value}
                className="flex h-24 w-full gap-1 rounded-[var(--radius)] border border-border bg-[var(--surface)] p-1"
              >
                <span
                  data-preview-theme={value === 'system' ? 'light' : value}
                  className="w-1/4 rounded-[var(--radius)] border border-border bg-[var(--surface-raised)]"
                />
                <span
                  data-preview-theme={value === 'system' ? 'dark' : value}
                  className="flex-1 rounded-[var(--radius)] bg-[var(--background)]"
                />
              </div>
              <div className="flex min-h-8 items-center gap-2 px-1">
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
