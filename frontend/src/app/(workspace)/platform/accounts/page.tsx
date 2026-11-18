import { AccountStatusForm } from '../../../../components/platform/account-status-form';
import { PlatformPage } from '../../../../components/platform/platform-page';
export default function AccountStatusPage() {
  return (
    <PlatformPage
      title="Account status"
      description="Disable an account to sign it out everywhere and block sign-in. Its organizations and content stay unchanged."
    >
      <AccountStatusForm />
    </PlatformPage>
  );
}
export const metadata = {
  title: 'Account status | Lexon',
  description: 'Manage account access and status.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
