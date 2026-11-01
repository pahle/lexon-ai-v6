import { expect, test } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { transitionTenant } from '../src/lib/tenant-queries';
test('tenant transition cancels and removes old state before publishing new selection', async () => {
  const client = new QueryClient();
  client.setQueryData(['tenant', 'old', 'documents'], ['Private old content']);
  let finish: (value: string[]) => void = () => {};
  const late = client
    .fetchQuery({
      queryKey: ['tenant', 'old', 'late'],
      queryFn: () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    })
    .catch(() => undefined);
  await transitionTenant(client, {
    version: 1,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Next',
    slug: 'next',
    kind: 'team',
    state: 'active',
    role: 'member',
    require2fa: false,
    createdAt: '2026-11-01T00:00:00Z',
  });
  finish(['Late old content']);
  await late;
  expect(client.getQueriesData({ queryKey: ['tenant', 'old'] })).toEqual([]);
  expect(client.getQueryData(['active-organization'])).toMatchObject({
    name: 'Next',
  });
});
