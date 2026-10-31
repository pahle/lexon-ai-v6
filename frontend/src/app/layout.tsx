import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '../components/query-provider';
import './globals.css';
export const metadata: Metadata = {
  title: 'Lexon — Foundation',
  description: 'Lexon foundation health and validation checks',
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
