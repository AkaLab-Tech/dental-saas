/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@assets': path.resolve(__dirname, './src/assets'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    // Unbounded (default: availableParallelism(), 8 on the CI-reproducing
    // host) fans this 93-file suite out to every core, leaving no headroom
    // for the concurrently-running @dental/api suite, @dental/web,
    // @dental/shared and whatever else shares the host (task #398).
    //
    // This cap is a secondary contributor, not the primary fix: the Step A
    // A/B (cap vs. no cap, same host load) moved the tail — mean/test 60.58ms
    // vs 77.03ms, p95 312 vs 413, p99 674 vs 1104, tests >1000ms: 6 vs 29 —
    // but did not close the 5s timeout margin on its own. What did was fixing
    // the expensive dom-testing-library role queries on the actual failing
    // tests' hot paths (AppointmentFormModal.test.tsx): 7220ms -> 798ms and
    // 3031ms -> 621ms after replacing document-wide/scoped `getByRole`
    // role+name and role+isInaccessible scans with plain DOM queries (see
    // that file's `selectTime()`, `selectCalendarDay()`, `getDoctorSelect()`
    // and `getDateTrigger()` helpers). Keep the cap for the tail it does
    // remove, but don't rely on it alone against a CPU-bound query.
    poolOptions: {
      threads: {
        maxThreads: 4,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.d.ts', 'src/test/**'],
    },
  },
})
