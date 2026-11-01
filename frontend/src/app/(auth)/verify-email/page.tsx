import { VerificationState } from '../../../components/auth/verification-state';
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string | undefined;
    error?: string | undefined;
    returnTo?: string | undefined;
  }>;
}) {
  const query = await searchParams;
  return (
    <VerificationState
      state={
        query.error
          ? 'expired'
          : query.state === 'confirmed'
            ? 'confirmed'
            : 'pending'
      }
      returnTo={query.returnTo}
    />
  );
}
