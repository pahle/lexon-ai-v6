import { notFound } from 'next/navigation';

export default function UnmatchedSettingsPage(): never {
  notFound();
}

export const metadata = {
  title: 'Settings page not found | Lexon',
  description: 'The requested settings page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
