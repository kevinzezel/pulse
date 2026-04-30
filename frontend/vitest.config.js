import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // Use the React 17+ automatic JSX runtime so .jsx files compile without
  // every component having to `import React`. Required by the
  // ServerBootGateModal unit tests, which call the component as a plain
  // function in node — without this, esbuild falls back to the classic
  // transform and throws `React is not defined`.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
