import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // A migration test opens, migrates and integrity-checks a real SQLite file; on a loaded Windows machine that
    // passes five seconds, and the default budget turns a slow disk into a red suite that has nothing to do with
    // the change under test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { include: ['src/**/*.ts'], exclude: ['src/**/*.d.ts'] },
  },
})
