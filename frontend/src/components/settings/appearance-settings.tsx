'use client';

import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { SettingsHeading } from './settings-section';

const themes = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

function PreviewPane({
  theme,
  className,
  bar = 'bg-[var(--input)]',
}: {
  theme: 'light' | 'dark';
  className: string;
  bar?: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      data-preview-theme={theme}
      className={`flex min-w-0 ${className}`}
    >
      <span className="flex-1 bg-[var(--sidebar)]" />
      <span className="flex flex-[2] flex-col gap-1.5 bg-[var(--background)] p-3">
        <span className={`h-2 w-3/5 rounded-[4px] ${bar}`} />
        <span className={`h-2 w-4/5 rounded-[4px] ${bar}`} />
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
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <SettingsHeading
        id={headingId}
        title="Appearance"
        description="Choose how Lexon looks on this device."
      />
      <RadioGroup
        aria-labelledby={headingId}
        value={theme ?? 'system'}
        onValueChange={(value) => setTheme(String(value))}
        className="flex w-full gap-4"
      >
        {themes.map(({ value, label }) => {
          const id = `${headingId}-${value}`;
          return (
            <Label
              key={value}
              htmlFor={id}
              data-slot="appearance-option"
              className="relative flex w-[180px] min-w-0 cursor-pointer flex-col gap-2 rounded-[10px] outline-none max-md:w-auto max-md:flex-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background"
            >
              <div
                aria-hidden="true"
                data-slot="appearance-preview"
                data-theme-preview={value}
                data-selected={theme === value}
                className="relative flex h-[110px] w-full min-w-0 overflow-hidden rounded-[10px] border border-input data-[selected=true]:border-2 data-[selected=true]:border-ring"
              >
                {value === 'system' ? (
                  <>
                    <PreviewPane
                      theme="light"
                      bar="bg-[var(--lexon-deleted)]"
                      className="absolute inset-0 [clip-path:inset(0_50%_0_0)]"
                    />
                    <PreviewPane
                      theme="dark"
                      bar="bg-[var(--lexon-deleted)]"
                      className="absolute inset-0 [clip-path:inset(0_0_0_50%)]"
                    />
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
              <span className="text-sm font-medium">{label}</span>
            </Label>
          );
        })}
      </RadioGroup>
    </section>
  );
}
