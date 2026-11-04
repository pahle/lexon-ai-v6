import { expect, test } from 'vitest';
import { PendingButton } from '../src/components/forms/pending-button';
import { render } from './render';

test('pending button centers its idle and pending labels in the reserved width', async () => {
  const view = await render(
    <PendingButton pending={false} pendingLabel="Saving…">
      Save changes
    </PendingButton>,
  );
  const button = view.container.querySelector('button')!;
  const idleLabel = button.querySelector(':scope > span > span:last-child')!;
  const reservedLabels = button.querySelector('.invisible')!;
  const reservedLabelWrappers = [...reservedLabels.children] as HTMLElement[];

  expect(idleLabel.className).toContain('justify-center');
  expect(reservedLabelWrappers).toHaveLength(2);
  expect(
    reservedLabelWrappers.every((label) =>
      label.className.includes('justify-center'),
    ),
  ).toBe(true);
  expect(reservedLabels.textContent).toContain('Save changes');
  expect(reservedLabels.textContent).toContain('Saving…');

  await view.rerender(
    <PendingButton pending={true} pendingLabel="Saving…">
      Save changes
    </PendingButton>,
  );
  expect(
    view.container.querySelector('button [aria-live="polite"]')?.className,
  ).toContain('justify-center');
  await view.unmount();
});
