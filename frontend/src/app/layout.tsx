import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '../components/query-provider';
import { ThemeProvider } from '../components/theme-provider';
import './globals.css';
export const metadata: Metadata = {
  title: 'Lexon',
  description: 'Your legal workspace',
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
