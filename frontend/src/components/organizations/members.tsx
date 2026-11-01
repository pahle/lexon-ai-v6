'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OrganizationSummary, OrgRole } from '@lexon/contracts';
import {
  identityApi,
  identityMessage,
  QueryFailure,
  useCursorPage,
} from './page-state';
import { AuthCard } from '../auth/auth-card';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
export function Members({
  organization,
}: {
  organization: OrganizationSummary;
}) {
  const query = useQueryClient();
  const { query: members, pagination } = useCursorPage(
    ['tenant', organization.id, 'members'],
    (cursor) =>
      identityApi.listMembers(organization.id, {
        limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
    organization.kind === 'team',
  );
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  if (organization.kind === 'personal')
    return <p>Personal has no team membership controls.</p>;
  if (members.error) return <QueryFailure error={members.error} />;
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure('');
    try {
      await action();
      await query.invalidateQueries({
        queryKey: ['tenant', organization.id, 'members'],
      });
    } catch (error) {
      setFailure(identityMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Members" description="Manage access to your team.">
      <ul>
        {members.data?.items.map((member) => (
          <li
            key={member.id}
            data-testid={'member-' + member.userId}
            className="flex flex-col gap-2 py-3"
          >
            <strong>{member.name}</strong>
            <span>{member.email}</span>
            <span>{member.role}</span>
            {organization.role === 'owner' ||
            (organization.role === 'admin' && member.role !== 'owner') ? (
              <div className="flex flex-wrap gap-2">
                {(['owner', 'admin', 'member'] as const)
                  .filter(
                    (role) =>
                      role !== member.role &&
                      (organization.role === 'owner' || role !== 'owner'),
                  )
                  .map((role: OrgRole) => (
                    <Button
                      key={role}
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate(() =>
                          identityApi.changeMemberRole(
                            organization.id,
                            member.id,
                            role,
                          ),
                        )
                      }
                    >
                      Make {role}
                    </Button>
                  ))}
              </div>
            ) : null}
            {organization.role === 'owner' ||
            (organization.role === 'admin' && member.role === 'member') ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void mutate(() =>
                    identityApi.removeMember(organization.id, member.id),
                  )
                }
              >
                Remove member
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {pagination}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void mutate(async () => {
            await identityApi.leaveOrganization(organization.id);
            await query.cancelQueries({ queryKey: ['tenant'] });
            query.removeQueries({ queryKey: ['tenant'] });
            window.location.assign('/workspace');
          })
        }
      >
        Leave organization
      </Button>
      {failure ? <FieldError>{failure}</FieldError> : null}
    </AuthCard>
  );
}
