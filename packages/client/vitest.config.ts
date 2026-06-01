import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
    // Client tests are minimal for MVP — pass even with 0 test files
    passWithNoTests: true,
  },
});
