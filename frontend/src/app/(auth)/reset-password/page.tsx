import { PasswordRecoveryForm } from '../../../components/auth/password-recovery-form';
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string | undefined;
    error?: string | undefined;
  }>;
}) {
  const query = await searchParams;
  return (
    <PasswordRecoveryForm
      mode="reset"
      token={query.error ? undefined : query.token}
    />
  );
}
