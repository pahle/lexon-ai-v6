import { AdminSetup } from '../../../components/auth/admin-setup';
export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return <AdminSetup setupToken={(await searchParams).token ?? ''} />;
}
export const metadata = {
  title: 'Administrator setup | Lexon',
  description: 'Complete the Lexon administrator setup process.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
