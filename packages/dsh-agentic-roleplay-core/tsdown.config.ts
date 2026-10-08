import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type TsdownPlugin, type UserConfig } from 'tsdown'
import pkg from './package.json' with { type: 'json' }

// The shell keys a client bundle by its package name.
const ID = pkg.name

/**
 * Modules the web shell hands to every client bundle. Anything else must be
 * inlined, because a require the shell cannot answer throws at load time.
 */
const SHELL_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/**
 * Compiles `*.module.css` into a class-name map and injects the stylesheet
 * when the bundle loads. The virtual id carries a `.mjs` suffix so the
 * bundler's own CSS handling ignores it.
 */
function cssModules(): TsdownPlugin {
  const prefix = '\0css-module:'
  const suffix = '.mjs'
  return {
    name: 'css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return prefix + resolve(dirname(importer), source) + suffix
    },
    async load(id: string) {
      if (!id.startsWith(prefix)) return null
      const file = id.slice(prefix.length, -suffix.length)
      this.addWatchFile(file)
      const { code, exports } = transform({
        filename: file,
        code: await readFile(file),
        cssModules: { pattern: 'rp_[hash]_[local]' },
        minify: true,
      })
      const classes = Object.fromEntries(Object.entries(exports ?? {}).map(([name, value]) => [name, value.name]))
      const key = relative(process.cwd(), file)
      // A reloaded bundle must replace its own stylesheet, not leave the stale one in place.
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const key = ${JSON.stringify(key)};`,
        "let tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(key) + ']');",
        'if (tag === null) {',
        "  tag = document.createElement('style');",
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = key;',
        '  document.head.appendChild(tag);',
        '}',
        'tag.textContent = css;',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}

const host: UserConfig = {
  name: `${ID}/host`,
  entry: { index: 'src/index.ts', orchestration: 'src/orchestration.ts', authoring: 'src/authoring.ts', compaction: 'src/compaction.ts', images: 'src/images.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: true,
  fixedExtension: false,
  deps: {
    neverBundle: specifier => specifier.startsWith('@deepseek-ai/'),
  },
}

const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: true,
  fixedExtension: false,
  deps: {
    neverBundle: specifier => SHELL_MODULES.has(specifier),
    alwaysBundle: specifier => !SHELL_MODULES.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  plugins: [cssModules(), {
    // Another feature plugin's runtime values are not reachable from a client
    // bundle; cross-plugin behavior goes through Cordis services and slots.
    name: 'shell-module-boundary',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/') || SHELL_MODULES.has(source)) return null
      throw new Error(`client bundle: "${source}" is not provided by the web shell; use a type-only import`)
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    // The shell evaluates the bundle through its module loader, not as a script.
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default defineConfig([host, client])
