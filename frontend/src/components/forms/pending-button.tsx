'use client';

import type { ReactNode } from 'react';
import type { ComponentProps } from 'react';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';

type ButtonProps = ComponentProps<typeof Button>;

export function PendingButton({
  pending,
  pendingLabel,
  children,
  ...buttonProps
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
} & ButtonProps) {
  return (
    <Button {...buttonProps} disabled={pending || buttonProps.disabled}>
      <span className="inline-grid [&>*]:col-start-1 [&>*]:row-start-1">
        <span className="invisible inline-grid" aria-hidden="true">
          <span className="col-start-1 row-start-1 inline-flex items-center gap-2">
            {children}
          </span>
          <span className="col-start-1 row-start-1 inline-flex items-center gap-2">
            <Spinner aria-hidden="true" />
            {pendingLabel}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-2"
          aria-live={pending ? 'polite' : undefined}
        >
          {pending ? (
            <>
              <Spinner aria-label={pendingLabel} />
              {pendingLabel}
            </>
          ) : (
            children
          )}
        </span>
      </span>
    </Button>
  );
}
