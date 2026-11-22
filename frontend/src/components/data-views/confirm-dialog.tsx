'use client';

import type { ComponentType, FC } from 'react';
import { CheckIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** LEX-DS-001 §5.5 confirmation: names the object, icon confirm button, deep red fill when access is removed. */
export const ConfirmDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  icon?: ComponentType<{ className?: string }>;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  icon: Icon = CheckIcon,
  destructive,
  pending,
  onConfirm,
}) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader className="gap-2 place-items-start text-left">
        <AlertDialogTitle className="leading-[normal]">
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-wrap md:text-wrap">
          {description}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="mt-2 flex-row justify-end">
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant={destructive ? 'destructive' : 'default'}
          disabled={pending}
          onClick={onConfirm}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
