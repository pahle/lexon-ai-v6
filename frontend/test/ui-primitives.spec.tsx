import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { render, settle } from './render';
import { Button } from '../src/components/ui/button';
import { Input } from '../src/components/ui/input';
import { Textarea } from '../src/components/ui/textarea';
import { Badge } from '../src/components/ui/badge';
import { Switch } from '../src/components/ui/switch';
import { Skeleton } from '../src/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../src/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../src/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../src/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../src/components/ui/tooltip';
import { Toaster } from '../src/components/ui/sonner';
import { toast } from 'sonner';

// LEX-DS-001 v3.1 §5.5 "Controls", "Dialogs, menus, toasts".
afterEach(() => {
  document.body.innerHTML = '';
});

const cls = (el: Element | null | undefined) => el?.getAttribute('class') ?? '';
const has = (el: Element | null | undefined, ...tokens: string[]) => {
  const list = cls(el).split(/\s+/);
  for (const token of tokens) expect(list).toContain(token);
};

test('buttons: 32px default, 30px small, 40px large, radius 8px, 14px weight 500', async () => {
  const view = await render(
    <>
      <Button>Default</Button>
      <Button size="sm">Small</Button>
      <Button size="lg">Large</Button>
      <Button size="icon">I</Button>
      <Button size="icon-sm">I</Button>
    </>,
  );
  const [d, sm, lg, icon, iconSm] = [...view.container.querySelectorAll('button')];
  has(d, 'h-8', 'px-3', 'rounded-[8px]', 'text-sm', 'font-medium');
  has(sm, 'h-[30px]', 'px-2.5', 'text-[13px]');
  has(lg, 'h-10', 'px-4');
  has(icon, 'size-8');
  has(iconSm, 'size-7', 'rounded-[6px]');
});

test('inputs and textarea: 36px, radius 8px, padding 0 12px, 14px', async () => {
  const view = await render(
    <>
      <Input aria-label="a" />
      <Textarea aria-label="b" />
    </>,
  );
  const input = view.container.querySelector('input');
  has(input, 'h-9', 'px-3', 'rounded-[8px]', 'text-sm');
  expect(cls(input)).not.toMatch(/(^|\s)(text-base|md:text-sm|px-2\.5)(\s|$)/);
  has(view.container.querySelector('textarea'), 'rounded-[8px]', 'px-3', 'text-sm');
});

test('badge: 20px, fully round, 12px weight 500', async () => {
  const view = await render(<Badge>New</Badge>);
  const badge = view.container.querySelector('[data-slot="badge"], span');
  has(badge, 'h-5', 'rounded-full', 'text-xs', 'font-medium', 'px-2');
  expect(cls(badge)).not.toContain('rounded-4xl');
});

test('switch is 36x20px and skeleton is a 12px muted line, radius 6px', async () => {
  const view = await render(
    <>
      <Switch aria-label="s" />
      <Skeleton />
    </>,
  );
  const sw = view.container.querySelector('[data-slot="switch"]');
  has(sw, 'data-[size=default]:h-5', 'data-[size=default]:w-9');
  const sk = view.container.querySelector('[data-slot="skeleton"]');
  has(sk, 'h-3', 'rounded-[6px]', 'bg-muted');
});

test('dialog: 440px, padding 24px, radius 12px, 18px semibold title, footer right-aligned', async () => {
  await render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Text</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
  await settle();
  const content = document.body.querySelector('[data-slot="dialog-content"]');
  has(content, 'p-6', 'rounded-[12px]', 'sm:max-w-[440px]', 'max-w-[calc(100%-2rem)]');
  has(document.body.querySelector('[data-slot="dialog-title"]'), 'text-lg', 'font-semibold');
  has(document.body.querySelector('[data-slot="dialog-description"]'), 'text-muted-foreground', 'leading-normal');
  const footer = document.body.querySelector('[data-slot="dialog-footer"]');
  has(footer, 'gap-2', 'sm:justify-end');
  expect(cls(footer)).not.toContain('bg-muted/50');
  expect(cls(footer)).not.toContain('-mx-4');
});

test('alert dialog: 440px, padding 24px, radius 12px, plain right-aligned footer', async () => {
  await render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete?</AlertDialogTitle>
          <AlertDialogDescription>Gone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="destructive">Delete</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
  await settle();
  const content = document.body.querySelector('[data-slot="alert-dialog-content"]');
  has(content, 'p-6', 'rounded-[12px]', 'data-[size=default]:sm:max-w-[440px]');
  has(document.body.querySelector('[data-slot="alert-dialog-title"]'), 'text-lg', 'font-semibold');
  has(document.body.querySelector('[data-slot="alert-dialog-description"]'), 'leading-normal');
  const footer = document.body.querySelector('[data-slot="alert-dialog-footer"]');
  has(footer, 'gap-2', 'sm:justify-end');
  expect(cls(footer)).not.toContain('bg-muted/50');
});

test('menu: radius 8px, padding 4px, 32px items, radius 4px, 14px', async () => {
  const view = await render(
    <DropdownMenu>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>One</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await act(async () => view.container.querySelector('button')!.click());
  await settle();
  has(document.body.querySelector('[data-slot="dropdown-menu-content"]'), 'rounded-[8px]', 'p-1');
  has(document.body.querySelector('[role="menuitem"]'), 'h-8', 'rounded-[4px]', 'px-2', 'text-sm', 'gap-2');
});

test('tooltip: 12px text on foreground, padding 4px 8px, radius 6px', async () => {
  await render(
    <Tooltip open>
      <TooltipTrigger>t</TooltipTrigger>
      <TooltipContent>Copy</TooltipContent>
    </Tooltip>,
  );
  await settle();
  has(document.body.querySelector('[data-slot="tooltip-content"]'), 'bg-foreground', 'text-xs', 'px-2', 'py-1', 'rounded-[6px]');
});

test('toaster: top-right, 20px/24px offsets, 320px wide, radius 10px, padding 12px 16px', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  await render(<Toaster />);
  await act(async () => {
    toast('Saved');
  });
  await settle();
  const list = document.body.querySelector('[data-sonner-toaster]') as HTMLElement;
  expect(list.getAttribute('data-y-position')).toBe('top');
  expect(list.getAttribute('data-x-position')).toBe('right');
  expect(list.style.getPropertyValue('--offset-top')).toBe('20px');
  expect(list.style.getPropertyValue('--offset-right')).toBe('24px');
  expect(list.style.getPropertyValue('--mobile-offset-top')).toBe('12px');
  expect(list.style.getPropertyValue('--mobile-offset-right')).toBe('12px');
  expect(list.style.getPropertyValue('--width')).toBe('320px');
  expect(list.style.getPropertyValue('--border-radius')).toBe('10px');
  has(document.body.querySelector('[data-sonner-toast]'), 'px-4!', 'py-3!', 'text-sm');
  vi.unstubAllGlobals();
});
