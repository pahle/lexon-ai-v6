'use client';

import * as React from 'react';
import { useRender } from '@base-ui/react/use-render';
import { cn } from '../../lib/utils';
import { useIsMobile } from '../../hooks/use-mobile';
import { Button } from './button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { PanelLeftIcon } from 'lucide-react';

const SIDEBAR_COOKIE_NAME = 'sidebar_state';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH_ICON = '48px';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

type SidebarContextProps = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};
const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context)
    throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

function useSidebarOptional() {
  return React.useContext(SidebarContext);
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const next = typeof value === 'function' ? value(open) : value;
      setOpenProp?.(next);
      if (!setOpenProp) _setOpen(next);
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
    [open, setOpenProp],
  );
  const toggleSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile((value) => !value);
    else setOpen((value) => !value);
  }, [isMobile, setOpen]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  const state: SidebarContextProps['state'] = open ? 'expanded' : 'collapsed';
  const contextValue = React.useMemo(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar],
  );
  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  side = 'left',
  collapsible = 'icon',
  className,
  children,
  dir,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right';
  collapsible?: 'icon';
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-mobile="true"
          className={cn(
            'w-(--sidebar-width) border-border bg-sidebar p-0 text-sidebar-foreground dark:border-border',
            className,
          )}
          style={{ '--sidebar-width': '256px' } as React.CSSProperties}
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Workspace navigation.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <div
      data-slot="sidebar"
      data-state={state}
      data-collapsible={state === 'collapsed' ? collapsible : ''}
      data-side={side}
      className="group peer hidden text-sidebar-foreground md:block"
    >
      <div
        data-slot="sidebar-gap"
        className={cn(
          'relative w-(--sidebar-width) bg-transparent transition-[width] duration-[var(--motion-duration)] ease-[var(--motion-easing)]',
          'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
        )}
      />
      <div
        data-sidebar="sidebar"
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) border-border transition-[left,right,width] duration-[var(--motion-duration)] ease-[var(--motion-easing)] md:flex',
          'data-[side=left]:left-0 data-[side=right]:right-0',
          'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l',
          className,
        )}
        {...props}
      >
        <div
          data-slot="sidebar-inner"
          className="flex size-full flex-col bg-sidebar"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const context = useSidebarOptional();
  if (!context) return null;
  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      className={cn('min-h-11 min-w-11', className)}
      onClick={(event) => {
        onClick?.(event);
        context.toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon aria-hidden="true" />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar="header"
      data-slot="sidebar-header"
      className={cn(
        'flex flex-col gap-2 p-2 group-data-[collapsible=icon]:p-0',
        className,
      )}
      {...props}
    />
  );
}
function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar="footer"
      data-slot="sidebar-footer"
      className={cn(
        'flex flex-col gap-2 p-2 group-data-[collapsible=icon]:p-0',
        className,
      )}
      {...props}
    />
  );
}
function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar="content"
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col overflow-auto', className)}
      {...props}
    />
  );
}
function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar="group"
      data-slot="sidebar-group"
      className={cn(
        'relative flex w-full min-w-0 flex-col p-2 group-data-[collapsible=icon]:p-0',
        className,
      )}
      {...props}
    />
  );
}
function SidebarGroupLabel({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-sidebar="group-label"
      data-slot="sidebar-group-label"
      className={cn(
        'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 transition-[margin,opacity] duration-[var(--motion-duration)] ease-[var(--motion-easing)] group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
        className,
      )}
      {...props}
    />
  );
}
function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-sidebar="menu"
      data-slot="sidebar-menu"
      className={cn('flex w-full min-w-0 flex-col', className)}
      {...props}
    />
  );
}
function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  );
}
function SidebarMenuButton({
  render,
  isActive = false,
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<'button'> &
  React.ComponentProps<'button'> & {
    isActive?: boolean;
    tooltip?: string | React.ComponentProps<typeof TooltipContent>;
  }) {
  const component = useRender({
    defaultTagName: 'button',
    props: {
      ...props,
      className: cn(
        'peer/menu-button group/menu-button flex min-h-11 min-w-11 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,padding] duration-[var(--motion-duration)] ease-[var(--motion-easing)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:p-1!',
        className,
      ),
    },
    render,
    state: {
      slot: 'sidebar-menu-button',
      sidebar: 'menu-button',
      active: isActive,
    },
  });
  if (!tooltip) return component;
  const content = typeof tooltip === 'string' ? { children: tooltip } : tooltip;
  return (
    <Tooltip>
      <TooltipTrigger render={component} />
      <TooltipContent {...content} />
    </Tooltip>
  );
}

export {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
  useSidebarOptional,
};
