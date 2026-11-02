import Link from 'next/link';

export default function WorkspaceNotFound() {
  return (
    <section className="flex flex-col gap-4 p-6">
      <h1 className="text-[length:var(--font-size-heading)] font-semibold">
        Page not found
      </h1>
      <p>The requested workspace page could not be found.</p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        href="/workspace"
      >
        Return to workspace
      </Link>
    </section>
  );
}

export const metadata = {
  title: 'Workspace page not found | Lexon',
  description: 'The requested workspace page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
