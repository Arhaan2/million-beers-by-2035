import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BEER_ADMIN_PIN: 'test-crew-code',
            SESSION_SIGNING_SECRET: 'test-session-signing-secret-that-is-long-enough',
            RATE_LIMIT_SALT: 'test-rate-limit-salt-that-is-long-enough',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      sequence: { concurrent: false },
    },
  };
});
