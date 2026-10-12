import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { releasePackages } from './release-packages.mjs'

const root = resolve(import.meta.dirname, '..')
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

  const readme = await readFile(resolve(directory, 'README.md'), 'utf8')
  if (!readme.startsWith(`# ${name}\n`)) throw new Error(`${name}: README heading must match the package name`)

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
      if (names.has(dependency) && range !== `workspace:${version}`) throw new Error(`${name}: ${field}.${dependency} must equal workspace:${version}`)
    }
  }

  if (manifest.main) await access(resolve(directory, manifest.main))
  if (manifest.types) await access(resolve(directory, manifest.types))
}

await access(resolve(root, 'LICENSE'))

for (const folder of ['dsh-roleplay-state', 'dsh-agentic-roleplay']) {
  const manifest = JSON.parse(await readFile(resolve(root, 'packages', folder, 'package.json'), 'utf8'))
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error(`${manifest.name}: missing DSH bundle declaration`)
  await access(resolve(root, 'packages', folder, 'cordis.patch.yml'))
}

console.log(`Release metadata and build outputs are valid for ${releasePackages.length} packages at ${version}.`)
