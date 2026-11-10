import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The state plugin is built before it is used by others; tests read it from source.
    alias: { '@dsh-agentic-roleplay/state': fileURLToPath(new URL('../dsh-roleplay-state/src/index.ts', import.meta.url)) },
  },
  test: {
    // The real-loop and benchmark tests spend minutes on a slow machine (Windows especially); the default 5s turned
    // that into false failures. A hang still fails, just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { include: ['src/**/*.{ts,tsx}'], exclude: ['src/**/*.d.ts'] },
  },
})
