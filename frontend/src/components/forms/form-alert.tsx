import { CircleAlertIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';

/**
 * The form-level alert above the fields (LEX-DS-001 v3.2 §5.1 Save failures):
 * red-text border on the flag tint, 10px radius, alert icon.
 */
export const FormAlert: FC<{ children: ReactNode }> = ({ children }) => (
  <div
    role="alert"
    data-slot="form-alert"
    className="border-lexon-red-text bg-lexon-flag text-foreground flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-sm leading-normal"
  >
    <CircleAlertIcon
      className="text-lexon-red-text mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
    <span>{children}</span>
  </div>
);
