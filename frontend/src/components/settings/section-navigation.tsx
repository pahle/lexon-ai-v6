import Link from 'next/link';

export function SectionNavigation({
  items,
}: {
  items: readonly { href: string; label: string; current: boolean }[];
}): React.ReactElement {
  return (
    <nav aria-label="Settings sections" className="min-w-0">
      <ul className="grid min-w-0 grid-cols-1 gap-2 min-[768px]:grid-cols-3">
        {items.map((item) => (
          <li key={item.href} className="min-w-0">
            <Link
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className="flex min-h-11 min-w-0 items-center border border-border px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
