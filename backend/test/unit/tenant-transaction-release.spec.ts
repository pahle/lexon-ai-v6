import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('pg', () => ({
  Pool: class {
    on() {}
    connect() {
      return Promise.resolve(client);
    }
  },
}));

const { TenantDatabase } = await import('../../src/infrastructure/db/index.js');

const ctx = { orgId: '00000000-0000-4000-8000-000000000001' };

describe('withTenant connection release', () => {
  beforeEach(() => {
    client.query.mockReset();
    client.release.mockReset();
  });

  it('destroys the connection when ROLLBACK fails so no open transaction or tenant context is reused', async () => {
    client.query.mockImplementation((sql: string) =>
      sql === 'ROLLBACK'
        ? Promise.reject(new Error('connection lost'))
        : Promise.resolve({ rows: [], rowCount: 0 }),
    );
    const database = new TenantDatabase({
      appUrl: 'postgres://unused',
      poolMax: 1,
      statementTimeoutMs: 1000,
    });

    await expect(
      database.withTenant(ctx, () => Promise.reject(new Error('handler failed'))),
    ).rejects.toThrow('handler failed');

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('returns a healthy connection to the pool after a successful ROLLBACK', async () => {
    client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const database = new TenantDatabase({
      appUrl: 'postgres://unused',
      poolMax: 1,
      statementTimeoutMs: 1000,
    });

    await expect(
      database.withTenant(ctx, () => Promise.reject(new Error('handler failed'))),
    ).rejects.toThrow('handler failed');

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0]?.[0]).toBeUndefined();
  });
});
