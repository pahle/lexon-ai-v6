import type { ReactNode } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../../lib/utils';

/** A platform card: 1px border, radius 12px, padding 20px, 16px gaps. */
export function PlatformCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <Card
      className={cn(
        'gap-4 rounded-xl p-5 [--card-spacing:--spacing(5)]',
        className,
      )}
    >
      <CardHeader className="gap-1 px-0">
        <CardTitle className="text-base leading-[1.21] font-semibold">
          {title}
        </CardTitle>
        {description ? (
          <CardDescription className="text-[13px] leading-[1.5]">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      {children}
    </Card>
  );
}

/** Right-aligned actions. */
export function PlatformActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn('flex flex-wrap justify-end gap-2', className)}>
      {children}
    </div>
  );
}
