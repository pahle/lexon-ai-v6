import { ArrowLeft } from 'lucide-react';
import { cn } from 'cn';
import { buttonVariants } from '../ui/button';
import { AuthCard } from './auth-card';
import { AuthLink, authButtonClass } from './auth-parts';
/** The prototype `invite-invalid` auth state, shared by the organization
 * invitation page and account-invitation sign-up. */
export function InvitationUnavailable() {
  return (
    <AuthCard
      presentation="page"
      title="Invitation unavailable"
      description="This invitation was cancelled, has expired, or has already been used. Ask the person who invited you to send a new one."
    >
      <a
        href="/workspace"
        className={cn(buttonVariants({ size: 'lg' }), authButtonClass)}
      >
        Go to Lexon
      </a>
      <AuthLink href="/sign-in" icon={<ArrowLeft aria-hidden="true" />}>
        Back to sign in
      </AuthLink>
    </AuthCard>
  );
}
