import { redirect } from 'next/navigation';

export default function SettingsIndexPage(): never {
  redirect('/settings/profile');
}

export const metadata = {
  title: 'Settings | Lexon',
  description: 'Manage your Lexon account settings.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
