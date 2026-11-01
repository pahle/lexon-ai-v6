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
