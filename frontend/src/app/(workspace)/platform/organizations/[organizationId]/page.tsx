import { OrganizationRecord } from '../../../../../components/platform-console/organization-record';
import { PlatformPage } from '../../../../../components/platform/platform-page';

export default async function OrganizationRecordPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return (
    <PlatformPage>
      <OrganizationRecord organizationId={organizationId} />
    </PlatformPage>
  );
}
export const metadata = {
  title: 'Organization | Lexon',
  description: 'Review a team organization and its members.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
