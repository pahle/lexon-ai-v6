'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { LockIcon } from 'lucide-react';
import { useWorkspace } from '../shell/workspace-provider';
import { consumeRouteHeadingFocus } from '../shell/navigation-focus';
import { StatusPage } from '../states/status-page';

// LEX-DS-001 §5.5 "Platform pages": one column, max 880px, padding 28px 24px
// 40px (mobile 20px 16px), 24px between blocks.

/** The page heading: the title (32px / 1.15) and a 14px description. */
export function PlatformHeading({
  title,
  description,
  aside,
}: {
  title: string;
  description?: string | undefined;
  /** Shown on the title line, for example a status badge. */
  aside?: ReactNode;
}) {
  const pathname = usePathname();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (consumeRouteHeadingFocus()) {
      const timer = window.setTimeout(() => heading.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const timer = window.setTimeout(() => heading.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  const h1 = (
    <h1
      ref={heading}
      tabIndex={-1}
      className="min-w-0 font-serif text-[32px] leading-[normal] font-normal tracking-[-0.005em] text-balance outline-none"
    >
      {title}
    </h1>
  );
  return (
    <header className="flex flex-col gap-1.5">
      {aside ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {h1}
          {aside}
        </div>
      ) : (
        h1
      )}
      {description ? (
        <p className="text-sm leading-[1.55] text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}

export function PlatformColumn({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[880px] flex-col gap-6 px-4 pt-5 pb-10 md:px-6 md:pt-7">
      {children}
    </div>
  );
}

/**
 * The platform page frame. Anyone who is not a platform administrator sees
 * the shared no-access status page and nothing of the platform content.
 * `title` is omitted by pages that draw their own heading from loaded data.
 */
export function PlatformPage({
  title,
  description,
  children,
}: {
  title?: string | undefined;
  description?: string | undefined;
  children: ReactNode;
}) {
  const { identity } = useWorkspace();
  if (!identity?.platformAdmin)
    return (
      <StatusPage
        role="alert"
        icon={<LockIcon />}
        title="You do not have access"
        text="This page is available to platform administrators only."
        action={{ label: 'Go to my workspace', href: '/workspace' }}
      />
    );
  return (
    <PlatformColumn>
      {title ? (
        <PlatformHeading title={title} description={description} />
      ) : null}
      {children}
    </PlatformColumn>
  );
}
