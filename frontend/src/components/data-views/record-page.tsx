import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import type { ComponentType, FC, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One column, all cards full width. */
export const RecordPage: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 pt-5 pb-10 md:gap-5 md:px-6 md:pt-7">
    {children}
  </div>
);

export const RecordHeader: FC<{
  backHref: string;
  backLabel: string;
  initials: string;
  square?: boolean;
  title: string;
  badges?: ReactNode;
  meta?: { icon: ComponentType<{ className?: string }>; text: string }[];
  actions?: ReactNode;
}> = ({
  backHref,
  backLabel,
  initials,
  square,
  title,
  badges,
  meta = [],
  actions,
}) => (
  <>
    <Link
      href={backHref}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mb-2 -ml-2.5 inline-flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-sm font-medium outline-none focus-visible:ring-3"
    >
      <ArrowLeftIcon className="size-4" aria-hidden="true" />
      {backLabel}
    </Link>
    <div className="flex flex-wrap items-center gap-4 pb-1">
      <span
        data-slot="record-avatar"
        aria-hidden="true"
        className={cn(
          'flex size-12 flex-none items-center justify-center text-base font-semibold md:size-14 md:text-lg',
          'size-14',
          square
            ? 'bg-sidebar-primary text-sidebar-primary-foreground rounded-[14px]'
            : 'bg-muted text-muted-foreground rounded-full',
        )}
      >
        {initials}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[26px] leading-[1.15] font-semibold md:text-3xl">
            {title}
          </h1>
          {badges}
        </div>
        {meta.length ? (
          <div className="text-muted-foreground flex flex-wrap gap-4 text-[13px]">
            {meta.map(({ icon: Icon, text }) => (
              <span key={text} className="inline-flex items-center gap-1.5">
                <Icon className="size-3.5" aria-hidden="true" />
                {text}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          {actions}
        </div>
      ) : null}
    </div>
  </>
);
