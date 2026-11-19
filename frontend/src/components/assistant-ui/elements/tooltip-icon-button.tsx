'use client';

import { type ComponentPropsWithRef, forwardRef } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
  tooltip: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  align?: 'start' | 'center' | 'end';
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(
  (
    {
      children,
      tooltip,
      side = 'bottom',
      sideOffset,
      align,
      className,
      ...rest
    },
    ref,
  ) => {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                {...rest}
                {...(align ? { 'data-align': align } : {})}
                className={cn(
                  'aui-button-icon size-6 p-1 active:scale-90',
                  className,
                )}
                ref={ref}
              />
            }
          >
            {children}
            <span className="aui-sr-only sr-only">{tooltip}</span>
          </TooltipTrigger>
          <TooltipContent
            side={side}
            {...(align ? { align } : {})}
            {...(sideOffset === undefined ? {} : { sideOffset })}
          >
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  },
);

TooltipIconButton.displayName = 'TooltipIconButton';
