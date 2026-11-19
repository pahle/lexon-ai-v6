import { cn } from 'cn';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('h-3 animate-pulse rounded-[6px] bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
