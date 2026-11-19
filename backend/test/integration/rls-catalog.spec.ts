import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import { createRlsInspector } from '../../src/infrastructure/db/testing/rls-fixture.js';

// A-17: every table in the `app` schema is tenant-fenced.
test('every app table has row-level security enabled and forced', async ({
  services,
}) => {
  const inspect = createRlsInspector(services);
  try {
    expect(await inspect.tableCount()).toBeGreaterThan(0);
    expect(await inspect.unfencedTables()).toEqual([]);
  } finally {
    await inspect.close();
  }
});

test('an app connection without the tenant GUC sees no rows in any app table', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const inspect = createRlsInspector(services);
  try {
    // Seed through the fixture (owner-side setup) so the zero counts are not vacuous.
    for (let org = 0; org < 2; org++) await ai.start(org);
    const visibility = await inspect.visibility();
    expect(visibility['ai_runs']!.owner).toBeGreaterThan(0);
    expect(
      Object.entries(visibility).filter(([, rows]) => rows.noContext > 0),
    ).toEqual([]);
  } finally {
    await Promise.all([ai.close(), inspect.close()]);
  }
});
