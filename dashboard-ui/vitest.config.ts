/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    /**
     * Vitest allows 5s per test by default, which is generous on an idle
     * laptop and not generous at all on a CI runner rendering 106 jsdom
     * suites across a couple of shared cores. Suites here have failed on
     * GitHub Actions while passing everywhere else - a jsdom render that
     * takes 100ms locally can take a hundred times that when it is competing
     * for the CPU, and the property-based suites pay that cost once per
     * generated case.
     *
     * The budget is a backstop against a hang, not a performance assertion:
     * a correct test does not get slower by being allowed more time, and the
     * suite as a whole is still bounded by the job timeout. Raising it buys
     * determinism and costs nothing when everything passes.
     */
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      // The dashboard renders instants in the tenant's zone, and falls back to
      // the *browser's* zone until settings load — so any test that asserts on
      // a rendered time is really asserting against the machine's timezone.
      // Pinning it here is what makes those tests mean the same thing on a
      // developer's laptop as they do in CI, which runs in UTC.
      TZ: 'UTC',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
