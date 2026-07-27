import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts on purpose: these are pure unit tests, so they
 * need none of the app's plugins (React, Tailwind, PWA) and run faster without them.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
