import { describe, expect, it } from 'vitest';
import { assertNotLastAdministrator } from '../../src/modules/identity-access/platform-admin.service.js';

describe('assertNotLastAdministrator', () => {
  it('refuses when the target is the only enabled administrator', () => {
    expect(() => assertNotLastAdministrator(['t'], 't')).toThrowError(
      expect.objectContaining({
        code: 'PLATFORM_LAST_ADMINISTRATOR',
        status: 409,
      }),
    );
  });
  it('allows when another enabled administrator remains', () => {
    expect(() => assertNotLastAdministrator(['t', 'o'], 't')).not.toThrow();
  });
});
