'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '../ui/button';
import { LexonLogo } from '../lexon-logo';
import { consumeRouteHeadingFocus } from '../shell/navigation-focus';

// LEX-DS-001 §5.5 "Status pages": one centered stack for not found,
// organization not found, workspace error and no access.

export type StatusAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type StatusPageProps = {
  /** A 24px icon, for example `<CompassIcon />` from lucide-react. */
  icon: ReactNode;
  title: string;
  /** One sentence. */
  text: string;
  /** The primary 40px button: a link when `href` is set, otherwise a button. */
  action?: StatusAction | undefined;
  secondaryLink?: { label: string; href: string } | undefined;
  /** `alert` for failures that are announced, `status` otherwise. */
  role?: 'alert' | undefined;
};

export function StatusPage({
  icon,
  title,
  text,
  action,
  secondaryLink,
  role,
}: StatusPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!consumeRouteHeadingFocus()) return;
    const timer = window.setTimeout(() => heading.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <section
      data-slot="status-page"
      role={role}
      className="flex min-h-0 flex-1 flex-col items-center justify-center pb-[120px]"
    >
      <div className="flex max-w-[440px] flex-col items-center gap-3 px-6 text-center">
        <span
          data-slot="status-page-icon"
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-[14px] bg-muted text-foreground [&_svg]:size-6"
        >
          {icon}
        </span>
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-1 outline-none font-serif text-[32px] leading-[1.15] font-normal text-balance"
        >
          {title}
        </h1>
        <p className="text-[15px] leading-[1.55] text-muted-foreground">
          {text}
        </p>
        {action || secondaryLink ? (
          <div className="mt-3 flex flex-col items-center gap-1.5">
            {action ? (
              <Button
                size="lg"
                {...(action.href
                  ? { render: <Link href={action.href} /> }
                  : { onClick: action.onClick })}
              >
                {action.label}
              </Button>
            ) : null}
            {secondaryLink ? (
              <Link
                href={secondaryLink.href}
                className="inline-flex items-center justify-center rounded-[8px] px-2.5 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {secondaryLink.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The standalone variant (no shell): wordmark top left, centered on mobile. */
export function StandaloneStatusPage(props: StatusPageProps) {
  return (
    <>
      <a
        className="sr-only inline-flex min-h-11 items-center focus:not-sr-only"
        href="#main"
      >
        Skip to content
      </a>
      <main
        id="main"
        tabIndex={-1}
        className="flex min-h-svh flex-col bg-background"
      >
        <div className="flex justify-center p-6 md:justify-start md:p-10">
          <LexonLogo
            variant="wordmark-compact"
            width={128}
            className="dark:hidden"
          />
          <LexonLogo
            variant="wordmark-compact"
            tone="white"
            width={128}
            className="hidden dark:block"
          />
        </div>
        <StatusPage {...props} />
      </main>
    </>
  );
}
