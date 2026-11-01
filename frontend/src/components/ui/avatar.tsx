'use client';
import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import { cn } from '../../lib/utils';

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar-initials"
      className={cn(
        'relative flex size-10 shrink-0 overflow-hidden rounded-full border border-border bg-muted',
        className,
      )}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-initials"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback };
