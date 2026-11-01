import { TwoFactorChallenge } from '../../../components/auth/two-factor-challenge';
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return <TwoFactorChallenge returnTo={(await searchParams).returnTo} />;
}
