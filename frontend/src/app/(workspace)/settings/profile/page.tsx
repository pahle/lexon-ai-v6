import { ProfileSettings } from '../../../../components/settings/profile-settings';
import { SettingsPageFrame } from '../../../../components/settings/settings-page-frame';

const items = [
  { href: '/settings/profile', label: 'Profile', current: true },
  { href: '/settings/security', label: 'Security', current: false },
  { href: '/settings/appearance', label: 'Appearance', current: false },
] as const;

export default function ProfilePage() {
  return (
    <SettingsPageFrame title="Profile settings" items={items}>
      <ProfileSettings />
    </SettingsPageFrame>
  );
}

export const metadata = {
  title: 'Profile settings | Lexon',
  description: 'Update your Lexon profile and display name.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
