import type { ReactNode } from 'react';
import { cn } from 'cn';

/** Section title (EB Garamond 26px) and description (13px muted). */
export function SettingsHeading({
  id,
  title,
  description,
  action,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-1',
        className,
      )}
    >
      <h2
        id={id}
        className="font-serif text-[26px] leading-[normal] font-normal"
      >
        {title}
      </h2>
      {action}
      {description ? (
        <p className="w-full text-[13px] leading-[normal] text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}

/**
 * A settings row: label (14px, 500) with a 13px description on the left,
 * the control on the right, 16px above and below and a 1px rule under it.
 * On mobile the control stacks under the label; `inline` rows (a switch or a
 * single button) stay side by side.
 */
export const settingsRowClass = (inline = false) =>
  cn(
    'flex justify-between gap-6 border-b border-border py-4 data-[invalid=true]:text-foreground',
    inline
      ? 'items-center'
      : 'items-center max-md:flex-col max-md:items-stretch max-md:gap-2.5',
  );

export const settingsLabelClass = 'text-sm leading-[normal] font-medium';
export const settingsDescriptionClass =
  'mt-0.5 text-[13px] leading-[normal] text-muted-foreground';

export function SettingsField({
  inline = false,
  className,
  ...props
}: React.ComponentProps<'div'> & { inline?: boolean }) {
  return (
    <div
      role="group"
      data-slot="field"
      className={cn(settingsRowClass(inline), className)}
      {...props}
    />
  );
}
