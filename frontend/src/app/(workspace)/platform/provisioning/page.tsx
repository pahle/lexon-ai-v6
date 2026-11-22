import { redirect } from 'next/navigation';

/** Retired route: provisioning lives in the Organizations list now. */
export default function ProvisioningPage(): never {
  redirect('/platform/organizations?state=provisioning');
}
export const metadata = {
  title: 'Organization provisioning | Lexon',
  description: 'Review organizations waiting for platform provisioning.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
