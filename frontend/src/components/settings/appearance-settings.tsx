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
    <fieldset className="flex flex-col gap-4">
      <legend id={headingId} className="text-base font-medium">
        Appearance
      </legend>
      <RadioGroup
        aria-labelledby={headingId}
        value={theme ?? 'system'}
        onValueChange={(value) => setTheme(String(value))}
        className="grid grid-cols-1 gap-2 min-[768px]:grid-cols-3"
      >
        {themes.map(({ value, label }) => {
          const id = `${headingId}-${value}`;
          return (
            <Label
              key={value}
              htmlFor={id}
              className="flex min-h-28 cursor-pointer flex-col items-stretch gap-2 rounded-[var(--radius)] border border-border bg-surface-raised p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <div className="flex min-h-8 items-center gap-2">
                <RadioGroupItem id={id} value={value} aria-label={label} />
                <span>{label}</span>
              </div>
              <div
                aria-hidden="true"
                data-slot="appearance-preview"
                className="flex h-12 w-full gap-1 rounded-[var(--radius)] border border-border bg-surface p-1"
              >
                <span className="w-1/4 rounded-[var(--radius)] bg-surface-raised" />
                <span className="flex-1 rounded-[var(--radius)] bg-background" />
              </div>
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
