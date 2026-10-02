import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The state plugin is built before it is used by others; tests read it from source.
    alias: { 'dsh-roleplay-state': fileURLToPath(new URL('../dsh-roleplay-state/src/index.ts', import.meta.url)) },
  },
})
