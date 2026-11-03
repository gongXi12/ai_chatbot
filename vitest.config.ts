import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setupEnv.ts'],
    coverage: {
      reporter: ['text', 'json', 'html']
    }
  }
});
