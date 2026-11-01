import { AppearanceSettings } from '../../../../components/settings/appearance-settings';
import { SettingsPageFrame } from '../../../../components/settings/settings-page-frame';

const items = [
  { href: '/settings/profile', label: 'Profile', current: false },
  { href: '/settings/security', label: 'Security', current: false },
  { href: '/settings/appearance', label: 'Appearance', current: true },
] as const;

export default function AppearancePage() {
  return (
    <SettingsPageFrame title="Appearance settings" items={items}>
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
