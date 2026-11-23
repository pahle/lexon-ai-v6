import { afterEach, expect, test, vi } from 'vitest';
import { Mail, Users } from 'lucide-react';
import {
  ConfirmDialog,
  DataListPage,
  DetailsCard,
  RecordHeader,
  RelatedTable,
  StatTiles,
} from '../../src/components/data-views';
import { render, settle } from '../render';
import { a11yViolations, byLabel, byText, click } from './helpers';
import { columns, people } from './fixture';

afterEach(() => {
  document.body.innerHTML = '';
});

test('list page header: title, description, primary action, tabs with count pills', async () => {
  const onTab = vi.fn();
  const view = await render(
    <DataListPage
      title="Accounts"
      description="Everyone with a Lexon account."
      action={<button>Invite</button>}
      tabs={[
        { value: 'accounts', label: 'Accounts', count: 248 },
        { value: 'invitations', label: 'Invitations', count: 2 },
      ]}
      tab="accounts"
      onTab={onTab}
    >
      <p>body</p>
    </DataListPage>,
  );
  expect(view.container.querySelector('h1')!.textContent).toBe('Accounts');
  const tabs = Array.from(view.container.querySelectorAll('[role="tab"]'));
  expect(tabs.map((t) => t.textContent)).toEqual([
    'Accounts248',
    'Invitations2',
  ]);
  expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  await click(tabs[1]!);
  expect(onTab).toHaveBeenCalledWith('invitations');
});

test('stat tiles render 2 to 4 tiles', async () => {
  const view = await render(
    <StatTiles
      items={[
        {
          icon: Users,
          label: 'Count',
          value: '128',
          supporting: 'Supporting line',
        },
        { icon: Mail, label: 'State', value: 'On' },
      ]}
    />,
  );
  const tiles = view.container.querySelectorAll('[data-slot="stat-tile"]');
  expect(tiles).toHaveLength(2);
  expect(tiles[0]!.textContent).toContain('128');
  expect(tiles[0]!.textContent).toContain('Supporting line');
});

test('record header: back link, 56px avatar, title, badges, meta, actions', async () => {
  const view = await render(
    <RecordHeader
      backHref="/platform/accounts"
      backLabel="Back to accounts"
      initials="AW"
      title="Ayu Wardani"
      badges={<span>Active</span>}
      meta={[{ icon: Mail, text: 'ayu@x.id' }]}
      actions={<button>Disable</button>}
    />,
  );
  expect(view.container.querySelector('a')!.getAttribute('href')).toBe(
    '/platform/accounts',
  );
  expect(
    view.container.querySelector('[data-slot="record-avatar"]')!.className,
  ).toContain('size-14');
  expect(view.container.querySelector('h1')!.textContent).toBe('Ayu Wardani');
  expect(view.container.textContent).toContain('ayu@x.id');
});

test('details card: property rows and a copy button for the mono id', async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  const view = await render(
    <DetailsCard
      rows={[
        { label: 'Email', value: 'ayu@x.id' },
        { label: 'ID', value: '3c8e1f6a-2b7d', copy: true },
      ]}
    />,
  );
  expect(view.container.querySelector('h2')!.textContent).toBe('Details');
  expect(view.container.querySelector('code')!.textContent).toBe(
    '3c8e1f6a-2b7d',
  );
  await click(byLabel(view.container, 'Copy ID')!);
  expect(writeText).toHaveBeenCalledWith('3c8e1f6a-2b7d');
});

test('related table states: ready, empty, error with retry', async () => {
  const onRetry = vi.fn();
  const common = {
    title: 'Teams',
    columns,
    rows: people,
    getRowId: (p: (typeof people)[number]) => p.id,
    onRetry,
    emptyText: 'No teams yet.',
  };
  const ready = await render(<RelatedTable {...common} status="ready" />);
  expect(ready.container.querySelector('h2')!.textContent).toContain('Teams');
  expect(ready.container.querySelector('h2')!.textContent).toContain('4');
  expect(ready.container.querySelectorAll('tbody tr')).toHaveLength(4);
  const empty = await render(
    <RelatedTable {...common} rows={[]} status="empty" />,
  );
  expect(empty.container.textContent).toContain('No teams yet.');
  const failed = await render(
    <RelatedTable {...common} rows={[]} status="error" />,
  );
  expect(failed.container.textContent).not.toContain('No teams yet.');
  await click(byText(failed.container, 'button', 'Try again')!);
  expect(onRetry).toHaveBeenCalledOnce();
});

test('confirm dialog: icon confirm button; destructive uses the deep fill', async () => {
  const onConfirm = vi.fn();
  await render(
    <ConfirmDialog
      open
      onOpenChange={vi.fn()}
      title="Disable this account?"
      description="Ayu can no longer sign in."
      confirmLabel="Disable"
      destructive
      onConfirm={onConfirm}
    />,
  );
  await settle();
  const confirm = byText(document.body, 'button', 'Disable')!;
  expect(confirm.className).toContain('bg-(--lexon-destructive-fill)');
  expect(confirm.querySelector('svg')).not.toBeNull();
  expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
  await click(confirm);
  expect(onConfirm).toHaveBeenCalledOnce();
});

{
  test(`record page parts a11y rules clean `, async () => {
    await render(
      <>
        <RecordHeader
          backHref="/x"
          backLabel="Back"
          initials="AW"
          title="Ayu"
          meta={[{ icon: Mail, text: 'a@b.id' }]}
        />
        <StatTiles
          items={[
            { icon: Users, label: 'Count', value: '1' },
            { icon: Mail, label: 'State', value: 'On' },
          ]}
        />
        <DetailsCard rows={[{ label: 'ID', value: 'abc', copy: true }]} />
      </>,
    );
    expect(a11yViolations()).toEqual([]);
  });
}
