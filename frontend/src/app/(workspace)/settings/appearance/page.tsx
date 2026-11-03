import { AppearanceSettings } from '../../../../components/settings/appearance-settings';
import { SettingsPageFrame } from '../../../../components/settings/settings-page-frame';

export default function AppearancePage() {
  return (
    <SettingsPageFrame title="Appearance settings">
      <AppearanceSettings />
    </SettingsPageFrame>
  );
}

export const metadata = {
  title: 'Appearance settings | Lexon',
  description: 'Choose light, dark, or system appearance for Lexon.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
