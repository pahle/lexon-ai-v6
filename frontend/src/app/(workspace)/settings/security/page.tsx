import { AccountSecurity } from '../../../../components/auth/account-security';
import { SettingsPageFrame } from '../../../../components/settings/settings-page-frame';

export default function SecurityPage() {
  return (
    <SettingsPageFrame title="Security settings">
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
