'use client';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { consumeRouteHeadingFocus } from './navigation-focus';

export function PageHeader(_props: { title: string; actions?: ReactNode }) {
  const { title, actions } = _props;
  const pathname = usePathname();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (consumeRouteHeadingFocus()) {
      const focusTimer = window.setTimeout(() => heading.current?.focus(), 0);
      return () => window.clearTimeout(focusTimer);
    }
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const focusTimer = window.setTimeout(() => heading.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [pathname]);
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
      <h1
        ref={heading}
        tabIndex={-1}
        className="min-w-0 text-balance font-serif text-2xl font-bold"
      >
        {title}
      </h1>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
