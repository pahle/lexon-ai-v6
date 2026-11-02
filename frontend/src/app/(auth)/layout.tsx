import type { ReactNode } from 'react';
export const metadata = {
  title: 'Lexon account',
  description: 'Sign in and manage your Lexon account.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function AuthLayout({ children }: { children: ReactNode }) {
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
        className="flex min-h-svh items-center justify-center p-6"
      >
        {children}
      </main>
    </>
  );
}
