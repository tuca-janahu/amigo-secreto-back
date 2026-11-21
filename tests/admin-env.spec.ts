import { afterEach, describe, expect, it, vi } from 'vitest';

// Test environment parsing without falling back to the developer's .env file.
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('ADMIN_USER_IDS configuration', () => {
  it.each([undefined, '', '   ', ', ,'])(
    'grants no access for %j',
    async (value) => {
      vi.stubEnv('ADMIN_USER_IDS', value);
      vi.resetModules();
      const { config } = await import('../src/config/env.js');
      expect(config.adminUserIds).toEqual([]);
      expect(Object.isFrozen(config.adminUserIds)).toBe(true);
    },
  );

  it('trims IDs and eliminates duplicates', async () => {
    vi.stubEnv('ADMIN_USER_IDS', ' admin-1 ,admin-2,admin-1, ');
    vi.resetModules();
    const { config } = await import('../src/config/env.js');
    expect(config.adminUserIds).toEqual(['admin-1', 'admin-2']);
  });

  it('rejects malformed configuration at startup', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin@example.com');
    vi.resetModules();
    await expect(import('../src/config/env.js')).rejects.toThrow(
      'ADMIN_USER_IDS',
    );
  });
});
