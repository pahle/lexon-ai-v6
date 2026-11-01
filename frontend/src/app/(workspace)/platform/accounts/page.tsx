import { AccountStatusForm } from '../../../../components/platform/account-status-form';
export default function AccountStatusPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <AccountStatusForm />
    </main>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
