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

function PreviewPane({
  theme,
  className,
}: {
  theme: 'light' | 'dark';
  className: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      data-preview-theme={theme}
      className={`flex min-w-0 gap-1.5 bg-[var(--background)] p-2 ${className}`}
    >
      <span className="w-1/4 shrink-0 rounded-sm bg-[var(--muted)]" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
        <span className="h-1.5 w-4/5 rounded bg-[var(--border)]" />
        <span className="h-1.5 w-full rounded bg-[var(--border)]" />
      </span>
    </span>
  );
}

export function AppearanceSettings(): React.ReactElement {
  const [mounted, setMounted] = useState(false);
  const headingId = useId();
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div aria-hidden="true" className="min-h-32" />;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="font-serif text-xl">
          Appearance
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose how Lexon looks on this device.
        </p>
      </div>
      <RadioGroup
        aria-labelledby={headingId}
        value={theme ?? 'system'}
        onValueChange={(value) => setTheme(String(value))}
        className="w-full max-w-[36rem] grid-cols-3 gap-4"
      >
        {themes.map(({ value, label }) => {
          const id = `${headingId}-${value}`;
          return (
            <Label
              key={value}
              htmlFor={id}
              data-slot="appearance-option"
              className="relative flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-[var(--radius)] outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background"
            >
              <div
                aria-hidden="true"
                data-slot="appearance-preview"
                data-theme-preview={value}
                data-selected={theme === value}
                className="flex h-28 w-full min-w-0 overflow-hidden rounded-[var(--radius)] border border-border bg-muted data-[selected=true]:border-2 data-[selected=true]:border-primary"
              >
                {value === 'system' ? (
                  <>
                    <PreviewPane theme="light" className="w-1/2" />
                    <PreviewPane theme="dark" className="w-1/2" />
                  </>
                ) : (
                  <PreviewPane theme={value} className="w-full" />
                )}
              </div>
              <RadioGroupItem
                id={id}
                value={value}
                aria-label={label}
                className="absolute inset-0 size-full opacity-0 after:hidden"
              />
              <span className="text-sm">{label}</span>
            </Label>
          );
        })}
      </RadioGroup>
    </section>
  );
}
