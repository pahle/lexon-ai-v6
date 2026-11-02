import { AcceptInvitation } from '../../../components/auth/accept-invitation';
export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ invitationId?: string | undefined; id?: string }>;
}) {
  return (
    <AcceptInvitation
      invitationId={
        (await searchParams).invitationId || (await searchParams).id || ''
      }
    />
  );
}
export const metadata = {
  title: 'Accept invitation | Lexon',
  description: 'Review and accept your Lexon organization invitation.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
