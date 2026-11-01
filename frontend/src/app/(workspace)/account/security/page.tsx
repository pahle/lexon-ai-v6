import { AccountSecurity } from '../../../../components/auth/account-security';
export default function AccountSecurityPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <AccountSecurity />
    </main>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
