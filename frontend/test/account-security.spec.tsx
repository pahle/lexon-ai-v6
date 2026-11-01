import { test, expect } from 'vitest';
import { useState, act } from 'react';
import { render } from './render';
import { RecoveryCodes } from '../src/components/auth/recovery-codes';
import { SessionList } from '../src/components/auth/session-list';
test('dismissed recovery codes leave no rendered copy or stored value', async () => {
  function Host() {
    const [show, setShow] = useState(true);
    return show ? (
      <RecoveryCodes
        codes={['recovery-secret-sentinel']}
        onDismiss={() => setShow(false)}
      />
    ) : (
      <p>Saved</p>
    );
  }
  const view = await render(<Host />);
  expect(view.container.textContent).toContain('recovery-secret-sentinel');
  await act(async () => view.container.querySelector('button')!.click());
  expect(view.container.textContent?.includes('recovery-secret-sentinel')).toBe(
    false,
  );
  expect(sessionStorage.length + localStorage.length).toBe(0);
  await view.unmount();
});
test('session list distinguishes Browser and Bearer and revokes only by safe id', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  let revoked = '';
  const rows = [
    {
      version: 1 as const,
      id,
      channel: 'bearer' as const,
      createdAt: '2026-11-01T00:00:00Z',
      expiresAt: '2026-11-01T00:15:00Z',
      current: false,
      token: 'token-secret-sentinel',
    },
    {
      version: 1 as const,
      id: '00000000-0000-4000-8000-000000000002',
      channel: 'cookie' as const,
      createdAt: '2026-11-01T00:00:00Z',
      expiresAt: '2026-11-08T00:00:00Z',
      current: true,
    },
  ];
  const view = await render(
    <SessionList
      sessions={rows}
      onRevoke={async (value) => {
        revoked = value;
      }}
    />,
  );
  expect(view.container.textContent).toContain('Browser');
  expect(view.container.textContent).toContain('Bearer');
  expect(view.container.textContent?.includes('token-secret-sentinel')).toBe(
    false,
  );
  await act(async () => view.container.querySelector('button')!.click());
  expect(revoked).toBe(id);
  await view.unmount();
});
