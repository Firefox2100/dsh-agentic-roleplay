import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { isPublished } from './npm-registry.mjs'
import { releasePackages } from './release-packages.mjs'

const root = resolve(import.meta.dirname, '..')
const requested = new Set(process.argv.slice(2).filter(argument => argument !== '--'))
const unknown = [...requested].filter(folder => !releasePackages.some(entry => entry.folder === folder))
if (unknown.length > 0) throw new Error(`Unknown release package folder: ${unknown.join(', ')}`)
const packages = requested.size === 0 ? releasePackages : releasePackages.filter(entry => requested.has(entry.folder))
const staging = await mkdtemp(join(tmpdir(), 'dsh-agentic-roleplay-publish-'))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
  return result.stdout
}

try {
  for (const entry of packages) {
    const manifest = JSON.parse(await readFile(resolve(root, 'packages', entry.folder, 'package.json'), 'utf8'))
    if (isPublished(entry.name, manifest.version)) {
      console.log(`Skipping ${entry.name}@${manifest.version}: already published.`)
      continue
    }

    const output = run('pnpm', ['--dir', `packages/${entry.folder}`, 'pack', '--json', '--pack-destination', staging])
    const packed = JSON.parse(output)
    const archive = isAbsolute(packed.filename) ? packed.filename : resolve(root, packed.filename)
    run('npm', ['publish', archive], { stdio: 'inherit' })
  }
} finally {
  await rm(staging, { recursive: true, force: true })
}
