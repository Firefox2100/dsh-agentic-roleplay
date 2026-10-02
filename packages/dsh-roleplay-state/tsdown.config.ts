import { defineConfig } from 'tsdown'

// The model package is private, so it is bundled into the build, types included.
// DSH's own packages must stay external: the plugin has to share the host's instances.
// Declarations are slow to build and the watcher does not need them.
export default defineConfig(({ watch }) => ({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: watch ? false : { eager: true },
  clean: false,
  sourcemap: true,
  fixedExtension: false,
  deps: { neverBundle: specifier => specifier.startsWith('@deepseek-ai/') },
}))
