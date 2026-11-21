'use client';

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../data-views';
import { identityApi, identityMessage } from '../organizations/page-state';

export const ORGANIZATIONS_KEY = ['platform', 'organizations'] as const;
export const organizationKey = (id: string) =>
  ['platform', 'organization', id] as const;

/** Resends the owner invitation of a provisioning organization; toasts the outcome. */
export async function resendOwnerInvitation(
  queryClient: QueryClient,
  organizationId: string,
): Promise<boolean> {
  try {
    await identityApi.resendOwnerInvitation(organizationId);
    toast.success('Owner invitation resent.');
    return true;
  } catch (error) {
    toast.error(identityMessage(error));
    return false;
  } finally {
    void queryClient.invalidateQueries({
      queryKey: organizationKey(organizationId),
    });
    void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_KEY });
  }
}

/** The named, destructive confirmation for Cancel provisioning (record page and row menu). */
export function CancelProvisioningDialog({
  open,
  organization,
  onClose,
  onCancelled,
}: {
  open: boolean;
  /** Kept after closing so the title does not change while the dialog animates out. */
  organization: { id: string; name: string } | null;
  onClose: () => void;
  onCancelled?: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function confirm(target: { id: string; name: string }) {
    setBusy(true);
    try {
      await identityApi.cancelProvisioning(target.id);
      toast.success('Provisioning cancelled.');
      // The organization no longer exists: drop it rather than refetch a 404.
      queryClient.removeQueries({ queryKey: organizationKey(target.id) });
      onCancelled?.();
    } catch (error) {
      toast.error(identityMessage(error));
      void queryClient.invalidateQueries({
        queryKey: organizationKey(target.id),
      });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_KEY });
      setBusy(false);
      onClose();
    }
  }

  return (
    <ConfirmDialog
      open={open && organization !== null}
      onOpenChange={(open) => !open && !busy && onClose()}
      title={`Cancel provisioning for ${organization?.name ?? ''}?`}
      description="This deletes the provisioning organization and invalidates its owner invitation."
      confirmLabel="Cancel provisioning"
      icon={XIcon}
      destructive
      pending={busy}
      onConfirm={() => organization && void confirm(organization)}
    />
  );
}
