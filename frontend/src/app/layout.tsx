import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '../components/query-provider';
import './globals.css';
export const metadata: Metadata = {
  title: 'Lexon',
  description: 'Your legal workspace',
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
