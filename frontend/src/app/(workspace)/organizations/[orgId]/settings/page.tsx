import { redirect } from 'next/navigation';

export default async function OrganizationSettingsIndexPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<never> {
  const { orgId } = await params;
  redirect(`/organizations/${orgId}/settings/members`);
}

export const metadata = {
  title: 'Organization settings | Lexon',
  description: 'Manage team settings and access.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
