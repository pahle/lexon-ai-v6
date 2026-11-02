import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-[length:var(--font-size-heading)] font-semibold">
        Page not found
      </h1>
      <p className="mt-4">The requested page could not be found.</p>
      <Link
        className="mt-4 inline-flex min-h-11 items-center underline"
        href="/workspace"
      >
        Return to workspace
      </Link>
    </main>
  );
}

export const metadata = {
  title: 'Page not found | Lexon',
  description: 'The requested page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
