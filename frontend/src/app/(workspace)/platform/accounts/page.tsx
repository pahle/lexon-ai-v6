import { AccountsPage } from '../../../../components/platform-console/accounts-page';
import { PlatformPage } from '../../../../components/platform/platform-page';

export default function PlatformAccountsPage() {
  return (
    <PlatformPage>
      <AccountsPage />
    </PlatformPage>
  );
}
export const metadata = {
  title: 'Accounts | Lexon',
  description: 'Review Lexon accounts and the people invited to create one.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
