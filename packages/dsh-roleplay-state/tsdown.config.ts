import { defineConfig } from 'tsdown'

// The model package is private, so it is bundled into the build, types included.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: { eager: true },
  clean: true,
  sourcemap: true,
  fixedExtension: false,
})
