import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    setupFiles: ['./src/test/diagnostics.ts', './src/test/setup.ts'],
    // Force clean exit after tests complete
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Timeout for hanging tests
    testTimeout: 30000,
    hookTimeout: 30000,
    // Ensure proper cleanup
    teardownTimeout: 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.d.ts'],
    },
  },
})
