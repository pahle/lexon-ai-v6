import { ProfileSettings } from '../../../../components/settings/profile-settings';
import { SettingsPageFrame } from '../../../../components/settings/settings-page-frame';

export default function ProfilePage() {
  return (
    <SettingsPageFrame title="Profile settings">
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
