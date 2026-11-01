import type { ReactNode } from 'react';
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      {children}
    </main>
  );
}
