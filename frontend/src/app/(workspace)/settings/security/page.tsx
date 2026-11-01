import { AccountSecurity } from '../../../../components/auth/account-security';
import { SettingsPageFrame } from '../../../../components/settings/settings-page-frame';

const items = [
  { href: '/settings/profile', label: 'Profile', current: false },
  { href: '/settings/security', label: 'Security', current: true },
  { href: '/settings/appearance', label: 'Appearance', current: false },
] as const;

export default function SecurityPage() {
  return (
    <SettingsPageFrame title="Security settings" items={items}>
      <AccountSecurity />
    </SettingsPageFrame>
  );
}

export const metadata = {
  title: 'Security settings | Lexon',
  description: 'Manage your password, authentication, email, and sessions.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
