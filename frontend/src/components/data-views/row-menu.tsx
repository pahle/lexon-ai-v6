'use client';

import { MoreHorizontalIcon } from 'lucide-react';
import { Fragment, type ComponentType, type FC } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type RowMenuItem = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  destructive?: boolean;
  /** A divider above this item (after ordering), as the prototype's row menus show. */
  separatorBefore?: boolean;
};

/** 28px icon button with an accessible name and tooltip; destructive items always last. */
export const RowMenu: FC<{ items: RowMenuItem[]; label?: string }> = ({
  items,
  label = 'Row actions',
}) => {
  const ordered = [
    ...items.filter((i) => !i.destructive),
    ...items.filter((i) => i.destructive),
  ];
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={label} />
              }
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        {ordered.map(
          ({
            label: text,
            icon: Icon,
            onSelect,
            destructive,
            separatorBefore,
          }) => (
            <Fragment key={text}>
              {separatorBefore ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                variant={destructive ? 'destructive' : 'default'}
                onClick={onSelect}
              >
                <Icon aria-hidden="true" />
                {text}
              </DropdownMenuItem>
            </Fragment>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
