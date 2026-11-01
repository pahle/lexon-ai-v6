import { AccountSecurity } from '../../../../components/auth/account-security';
export default function AccountSecurityPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <AccountSecurity />
    </div>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
