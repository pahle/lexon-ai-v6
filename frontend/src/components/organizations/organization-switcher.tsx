'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OrganizationSummary } from '@lexon/contracts';
import { transitionTenant } from '../../lib/tenant-queries';
import { identityApi, identityMessage } from './page-state';
import { AuthCard } from '../auth/auth-card';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
export function OrganizationSwitcher({
  organizations,
  current,
}: {
  organizations: readonly OrganizationSummary[];
  current: OrganizationSummary;
}) {
  const query = useQueryClient();
  const [selected, setSelected] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  return (
    <AuthCard title="Your workspace" description="Choose an organization.">
      {busy ? (
        <p role="status">Switching organization…</p>
      ) : (
        <>
          <p data-testid="active-organization">
            {selected.kind === 'personal' ? 'Personal' : selected.name}
          </p>
          <ul>
            {organizations.map((org) => (
              <li key={org.id}>
                <Button
                  variant="outline"
                  disabled={org.id === selected.id}
                  onClick={async () => {
                    setBusy(true);
                    setFailure('');
                    try {
                      const result = await identityApi.switchOrganization(
                        org.id,
                      );
                      if (result.status === 'enrollment_required') {
                        setMessage(
                          'Set up or verify your authenticator to enter this organization. Your current organization is unchanged.',
                        );
                        return;
                      }
                      await transitionTenant(query, result.organization);
                      setSelected(result.organization);
                      window.location.assign('/workspace');
                    } catch (error) {
                      setFailure(identityMessage(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Switch to {org.kind === 'personal' ? 'Personal' : org.name}
                </Button>
              </li>
            ))}
          </ul>
          {selected.kind === 'team' ? (
            <div className="flex flex-wrap gap-4">
              <a href={'/organizations/' + selected.id + '/members'}>Members</a>
              {selected.role !== 'member' ? (
                <a href={'/organizations/' + selected.id + '/invitations'}>
                  Invitations
                </a>
              ) : null}
              {selected.role === 'owner' ? (
                <a href={'/organizations/' + selected.id + '/settings'}>
                  Organization settings
                </a>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {message ? (
        <p role="status">
          {message} <a href="/account/security">Account security</a>
        </p>
      ) : null}
      {failure ? <FieldError>{failure}</FieldError> : null}
    </AuthCard>
  );
}
