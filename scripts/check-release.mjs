import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DSH_DEPENDENCY_RANGE, DSH_ENGINES, DSH_RELEASES } from './dsh-compat.mjs'
import { releasePackages } from './release-packages.mjs'

const root = resolve(import.meta.dirname, '..')
/** Text from the working tree: a Windows checkout may hold CRLF where the repository holds LF. */
const readText = async path => (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
const names = new Set(releasePackages.map(({ name }) => name))
const workspace = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const version = workspace.version
if (typeof version !== 'string' || version.length === 0) throw new Error('workspace version is missing')

for (const { folder, name } of releasePackages) {
  const directory = resolve(root, 'packages', folder)
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (manifest.name !== name) throw new Error(`${folder}: expected package name ${name}`)
  if (manifest.version !== version) throw new Error(`${name}: expected version ${version}, got ${manifest.version}`)
  if (manifest.private) throw new Error(`${name}: publishable package must not be private`)
  if (typeof manifest.description !== 'string' || manifest.description.length === 0) throw new Error(`${name}: description is missing`)
  if (manifest.author?.name !== 'Firefox2100' || manifest.author?.url !== 'https://github.com/Firefox2100') throw new Error(`${name}: author metadata is incorrect`)
  if (manifest.license !== 'GPL-3.0-only') throw new Error(`${name}: unexpected license`)
  if (manifest.publishConfig?.access !== 'public') throw new Error(`${name}: package must publish publicly`)
  if (manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') throw new Error(`${name}: npm registry is incorrect`)
  if (manifest.repository?.type !== 'git' || manifest.repository?.url !== 'git+https://github.com/Firefox2100/dsh-agentic-roleplay.git') throw new Error(`${name}: repository metadata is incorrect`)
  if (manifest.repository?.directory !== `packages/${folder}`) throw new Error(`${name}: repository directory is incorrect`)
  if (typeof manifest.homepage !== 'string' || !manifest.homepage.startsWith('https://firefox2100.github.io/dsh-agentic-roleplay/')) throw new Error(`${name}: documentation homepage is missing`)
  if (manifest.bugs?.url !== 'https://github.com/Firefox2100/dsh-agentic-roleplay/issues') throw new Error(`${name}: issue tracker is incorrect`)
  if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes('deepseek-harness')) throw new Error(`${name}: keywords are missing`)
  if (!Array.isArray(manifest.files) || !manifest.files.includes('README.md') || !manifest.files.includes('LICENSE')) throw new Error(`${name}: README.md and LICENSE must be included`)
  if (manifest.scripts?.prepack !== 'node -e "require(\'node:fs\').copyFileSync(\'../../LICENSE\', \'LICENSE\')"') throw new Error(`${name}: prepack must copy the repository license into the package`)
  if (manifest.scripts?.postpack !== 'node -e "require(\'node:fs\').rmSync(\'LICENSE\', { force: true })"') throw new Error(`${name}: postpack must remove the staged package license`)

  const readme = await readText(resolve(directory, 'README.md'))
  if (!readme.startsWith(`# ${name}\n`)) throw new Error(`${name}: README heading must match the package name`)

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
      if (names.has(dependency) && range !== `workspace:${version}`) throw new Error(`${name}: ${field}.${dependency} must equal workspace:${version}`)
    }
  }

  if (folder !== 'dsh-agentic-roleplay') {
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith('@deepseek-ai/')) throw new Error(`${name}: ${dependency} must be a peer dependency`)
    }
  }

  for (const field of ['dependencies', 'devDependencies']) {
    for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
      if (dependency.startsWith('@deepseek-ai/dsh-') && range !== DSH_DEPENDENCY_RANGE) throw new Error(`${name}: ${field}.${dependency} must be ${DSH_DEPENDENCY_RANGE}`)
    }
  }
  if (manifest.peerDependencies?.['@deepseek-ai/dsh'] !== undefined && manifest.peerDependencies['@deepseek-ai/dsh'] !== DSH_ENGINES) throw new Error(`${name}: the @deepseek-ai/dsh peer must be ${DSH_ENGINES}`)
  if (folder !== 'dsh-roleplay-model' && manifest.engines?.dsh !== DSH_ENGINES) throw new Error(`${name}: engines.dsh must be ${DSH_ENGINES}`)
  if (manifest.dsh?.engines !== undefined) throw new Error(`${name}: DSH reads engines.dsh, not dsh.engines`)

  if (manifest.main) await access(resolve(directory, manifest.main))
  if (manifest.types) await access(resolve(directory, manifest.types))
}

await access(resolve(root, 'LICENSE'))

const bundleFolders = ['dsh-roleplay-state', 'dsh-agentic-roleplay-core', 'dsh-agentic-roleplay']
const bundleLocales = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']
for (const folder of bundleFolders) {
  const directory = resolve(root, 'packages', folder)
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error(`${manifest.name}: missing DSH bundle declaration`)
  if (manifest.exports?.['./locale/*.json'] !== './locale/*.json' || !manifest.files.includes('locale')) throw new Error(`${manifest.name}: locale metadata must be exported and published`)
  await access(resolve(directory, 'cordis.patch.yml'))
  for (const locale of bundleLocales) {
    const metadata = JSON.parse(await readFile(resolve(directory, 'locale', `${locale}.json`), 'utf8'))
    for (const field of ['title', 'description']) {
      if (typeof metadata.meta?.[field] !== 'string' || metadata.meta[field].trim() === '') throw new Error(`${manifest.name}: locale/${locale}.json meta.${field} is missing`)
    }
  }
}


const standaloneBundles = [
  ['dsh-roleplay-state', '@dsh-agentic-roleplay/state', 'roleplay-state'],
  ['dsh-agentic-roleplay-core', '@dsh-agentic-roleplay/core', 'roleplay'],
]
for (const [folder, name, id] of standaloneBundles) {
  const directory = resolve(root, 'packages', folder)
  const expected = `- insert:\n    - id: ${id}\n      name: '${name}'\n`
  if (await readText(resolve(directory, 'cordis.patch.yml')) !== expected) throw new Error(`${name}: standalone bundle must insert only its own plugin row`)
}

const allDirectory = resolve(root, 'packages', 'dsh-agentic-roleplay')
const allManifest = JSON.parse(await readFile(resolve(allDirectory, 'package.json'), 'utf8'))
const allPatch = await readText(resolve(allDirectory, 'cordis.patch.yml'))
for (const name of [
  '@deepseek-ai/dsh-experimental-voice-input-bundle',
  '@deepseek-ai/dsh-experimental-speech-to-text',
  '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
  '@deepseek-ai/dsh-experimental-api-speech-to-text',
  '@deepseek-ai/dsh-experimental-client-ui-voice-input',
]) {
  if (allManifest.dependencies?.[name] !== undefined) throw new Error(`${allManifest.name}: DSH speech packages must be installed separately so they follow the runtime release`)
  if (allPatch.includes(name)) throw new Error(`${allManifest.name}: bundle patch must not insert DSH speech package ${name}`)
}

const workspaceFile = await readText(resolve(root, 'pnpm-workspace.yaml'))
if (!workspaceFile.includes(`  '@deepseek-ai/dsh': '${DSH_DEPENDENCY_RANGE}'\n`)) throw new Error(`pnpm-workspace.yaml must override @deepseek-ai/dsh to '${DSH_DEPENDENCY_RANGE}' (run pnpm sync:dsh)`)
const resolvedDsh = new Set([...(await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8')).matchAll(/^  '@deepseek-ai\/dsh[a-z-]*@([^':(]+)/gm)].map(match => match[1]))
if (resolvedDsh.size !== 1) throw new Error(`pnpm-lock.yaml must resolve every DSH package to one release, found ${[...resolvedDsh].join(', ')}`)
for (const release of resolvedDsh) {
  if (!DSH_RELEASES.includes(release)) throw new Error(`pnpm-lock.yaml resolves DSH to ${release}, which is not a tested release; verify it, then add it to scripts/dsh-compat.mjs`)
}

// The shell loads the client bundle by module id and supplies the modules it may require. A stray import either fails
// in every slot or ties the plugin to one DSH build that happens to export it.
const coreDirectory = resolve(root, 'packages', 'dsh-agentic-roleplay-core')
const clientBundle = await readText(resolve(coreDirectory, 'lib', 'client.js'))
const [bundleHead, bundleId] = clientBundle.split('\n')
if (bundleHead !== 'window.__ModuleLoader__.load({' || bundleId !== '\tid: "@dsh-agentic-roleplay/core",') throw new Error('the client bundle no longer uses the module format the shell loads (see the tsdown banner)')
const shellProvided = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-slots'])
for (const [, name] of clientBundle.matchAll(/require\("([^"]+)"\)/g)) {
  if (!shellProvided.has(name)) throw new Error(`the client bundle requires ${name}, which the shell does not provide: bundle it instead (tsdown SHELL_MODULES) or drop the import`)
}
for (const name of ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-dockkit']) {
  if (clientBundle.includes(name)) throw new Error(`the client bundle still mentions ${name}: the plugin owns its controls and its store`)
}

// The host bundle leaves DSH imports for the profile to supply, while the private model package stays inlined.
const hostBundle = await readText(resolve(coreDirectory, 'lib', 'index.js'))
if (hostBundle.includes('dsh-roleplay-model')) throw new Error('the host bundle still imports the private model package instead of inlining it')
if (hostBundle.includes('@deepseek-ai/dsh-client-')) throw new Error('the host bundle must not import client packages')

console.log(`Release metadata and build outputs are valid for ${releasePackages.length} packages at ${version}.`)
