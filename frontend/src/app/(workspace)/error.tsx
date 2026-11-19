'use client';

import { AlertCircleIcon } from 'lucide-react';
import { useEffect } from 'react';
import { StatusPage } from '../../components/states/status-page';

export default function WorkspaceError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  // The sidebar must not highlight the route that failed (owner review):
  // app-sidebar reads this flag with `in-data-[workspace-error]`.
  useEffect(() => {
    document.body.dataset.workspaceError = '';
    return () => {
      delete document.body.dataset.workspaceError;
    };
  }, []);
  return (
    <StatusPage
      role="alert"
      icon={<AlertCircleIcon />}
      title="Something went wrong"
      text="We could not load this page. Your work is saved."
      action={{ label: 'Try again', onClick: retry }}
      secondaryLink={{ label: 'Go to my workspace', href: '/workspace' }}
    />
  );
}
