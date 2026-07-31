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
