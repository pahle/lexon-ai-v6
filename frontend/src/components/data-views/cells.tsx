import { ChevronRightIcon, MailIcon } from 'lucide-react';
import Link from 'next/link';
import type { FC, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Shape = 'person' | 'organization' | 'invitation';

/**
 * The 32px lead of a table identity cell and a mobile row (prototype
 * revision 16 `.dv-av`): a round initials avatar, an 8px-radius organization
 * tile, or a round dashed invitation avatar with a mail icon.
 */
export const IdentityAvatar: FC<{
  initials?: string;
  shape?: Shape;
  icon?: ReactNode;
}> = ({ initials, shape = 'person', icon }) => (
  <span
    aria-hidden="true"
    data-slot="identity-avatar"
    className={cn(
      'flex size-8 flex-none items-center justify-center text-xs font-semibold',
      shape === 'person' && 'bg-muted text-muted-foreground rounded-full',
      shape === 'organization' &&
        'bg-sidebar-primary text-sidebar-primary-foreground rounded-[8px]',
      shape === 'invitation' &&
        'border-input text-muted-foreground rounded-full border border-dashed',
    )}
  >
    {shape === 'invitation' ? (
      <MailIcon className="size-3.5" />
    ) : (
      (icon ?? initials)
    )}
  </span>
);

/** Avatar, organization tile, or dashed invitation avatar; name, second line, optional badge. */
export const IdentityCell: FC<{
  name: string;
  secondary?: string;
  initials?: string;
  icon?: ReactNode;
  shape?: Shape;
  badge?: ReactNode;
}> = ({ name, secondary, initials, icon, shape = 'person', badge }) => (
  <div className="flex min-w-0 items-center gap-2.5">
    <IdentityAvatar
      shape={shape}
      {...(initials ? { initials } : {})}
      {...(icon ? { icon } : {})}
    />
    <span className="flex min-w-0 flex-col leading-[1.3]">
      <b className="flex items-center gap-1.5 truncate font-medium">
        <span className="truncate">{name}</span>
        {badge}
      </b>
      {secondary ? (
        <small className="text-muted-foreground truncate text-xs">
          {secondary}
        </small>
      ) : null}
    </span>
  </div>
);

export const TextCell: FC<{ children: ReactNode }> = ({ children }) => (
  <>{children}</>
);
export const MutedCell: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="text-muted-foreground">{children}</span>
);
export const NumberCell: FC<{ value: number }> = ({ value }) => (
  <span className="tabular-nums">{value}</span>
);

/** `Rp 1.250.000`: dot thousands, no decimals. */
export const formatRupiah = (amount: number) =>
  `Rp ${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
export const MoneyCell: FC<{ amount: number }> = ({ amount }) => (
  <span className="tabular-nums">{formatRupiah(amount)}</span>
);

const tones = {
  neutral: 'border-input text-foreground',
  // Prototype revision 16 `.badge.warn`: red-text, border 45% red-text.
  warning: 'border-lexon-red-text/45 text-lexon-red-text',
  inactive: 'border-input text-muted-foreground',
} as const;

export const StatusBadge: FC<{
  tone?: keyof typeof tones;
  children: ReactNode;
}> = ({ tone = 'neutral', children }) => (
  <span
    className={cn(
      'inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium',
      tones[tone],
    )}
  >
    {children}
  </span>
);

export const OnOffDot: FC<{ on: boolean }> = ({ on }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 rounded-full',
        on ? 'bg-[#2F8F5B]' : 'bg-muted-foreground',
      )}
    />
    {on ? 'On' : 'Off'}
  </span>
);

export const TagCell: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="bg-muted inline-flex h-5 items-center rounded px-1.5 text-xs font-medium">
    {children}
  </span>
);

export const LinkCell: FC<{ href: string; children: ReactNode }> = ({
  href,
  children,
}) => (
  <Link
    href={href}
    className="decoration-input underline underline-offset-[3px]"
  >
    {children}
  </Link>
);

/** Related row opens its record. */
export const OpenCell: FC<{
  label: string;
  onOpen?: () => void;
  href?: string;
}> = ({ label, onOpen, href }) => {
  const cls =
    'text-muted-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-3';
  const icon = <ChevronRightIcon className="size-4" aria-hidden="true" />;
  return href ? (
    <Link href={href} aria-label={`Open ${label}`} className={cls}>
      {icon}
    </Link>
  ) : (
    <button
      type="button"
      aria-label={`Open ${label}`}
      onClick={onOpen}
      className={cls}
    >
      {icon}
    </button>
  );
};
