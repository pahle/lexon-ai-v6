import { AdminSetup } from '../../../components/auth/admin-setup';
export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return <AdminSetup setupToken={(await searchParams).token ?? ''} />;
}
