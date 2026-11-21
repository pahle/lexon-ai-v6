import { redirect } from 'next/navigation';

/** Retired route: provisioning lives in the Organizations list now. */
export default function ProvisioningPage(): never {
  redirect('/platform/organizations?state=provisioning');
}
