import type { ComponentProps, ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from 'cn';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';

// LEX-DS-001 v3.1 §5.5 "Auth pages": title block, form alert, secondary link.

export function AuthHeader({
  title,
  description,
  headingLevel = 1,
}: {
  title: string;
  description?: ReactNode;
  headingLevel?: 1 | 2 | 3;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <header className="flex flex-col items-start gap-2.5 text-left">
      <Heading className="font-serif text-[30px] leading-[1.1] font-normal tracking-[-0.01em] md:text-4xl">
        {title}
      </Heading>
      {description ? (
        <p className="text-[15px] leading-[1.55] text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}

// `flag` background, 1px red-text border, radius 10px, padding 12px 14px.
export function AuthAlert({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <Alert
      role="alert"
      variant="destructive"
      className="grid-cols-[auto_1fr] items-start gap-x-2.5 rounded-[10px] border-(--lexon-red-text) bg-(--lexon-flag) px-3.5 py-3 text-sm leading-normal text-foreground *:[svg]:row-span-1 *:[svg]:mt-0.5 *:[svg]:size-4 *:[svg]:translate-y-0 *:[svg]:text-(--lexon-red-text)"
    >
      <CircleAlert />
      {title ? (
        <AlertTitle className="col-start-2 text-sm font-medium text-foreground">
          {title}
        </AlertTitle>
      ) : null}
      <AlertDescription className="col-start-2 text-sm leading-normal text-foreground">
        {children}
      </AlertDescription>
    </Alert>
  );
}

export const authLinkClass =
  'inline-flex items-center justify-center gap-2 self-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0';

// Secondary link: 14px weight 500 muted-foreground, 16px icon, centered.
export function AuthLink({
  icon,
  className,
  children,
  ...props
}: ComponentProps<'a'> & { icon?: ReactNode }) {
  return (
    <a
      data-slot="auth-link"
      className={cn(authLinkClass, className)}
      {...props}
    >
      {icon}
      {children}
    </a>
  );
}

// Inputs 44px, 15px, radius 8px, padding 0 14px, on `background`.
export const authInputClass =
  'h-11 bg-background px-3.5 text-[15px] md:text-[15px] dark:bg-background disabled:opacity-60 disabled:bg-background dark:disabled:bg-background aria-invalid:border-lexon-red-text aria-invalid:ring-0 dark:aria-invalid:border-lexon-red-text dark:aria-invalid:ring-0';

// Full-width primary button, 40px.
export const authButtonClass = 'w-full disabled:opacity-100';
