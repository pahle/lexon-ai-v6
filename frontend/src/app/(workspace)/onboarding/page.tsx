import { redirect } from 'next/navigation';
import { loadIdentityPage } from '../../../lib/identity-page';
import { Onboarding } from '../../../components/organizations/onboarding';
export default async function OnboardingPage() {
  const result = await loadIdentityPage();
  if (!result.identity) return result.view;
  if (result.identity.user.onboardingCompleted) redirect('/workspace');
  const invitations = await result.api.listMyInvitations({ limit: 100 });
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Onboarding
        profile={result.identity.user}
        invitations={invitations.items}
      />
    </div>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
