import { OrganizationRecord } from '../../../../../components/platform-console/organization-record';

export default async function OrganizationRecordPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <OrganizationRecord organizationId={organizationId} />;
}
export const metadata = {
  title: 'Organization | Lexon',
  description: 'Review a team organization and its members.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
