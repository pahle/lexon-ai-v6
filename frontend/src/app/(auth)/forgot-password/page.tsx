import { PasswordRecoveryForm } from '../../../components/auth/password-recovery-form';
export default function ForgotPasswordPage() {
  return <PasswordRecoveryForm mode="request" />;
}
export const metadata = {
  title: 'Reset password | Lexon',
  description: 'Request a password reset for your Lexon account.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
