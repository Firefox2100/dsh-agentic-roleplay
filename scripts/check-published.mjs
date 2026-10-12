import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isPublished } from './npm-registry.mjs'
import { releasePackages } from './release-packages.mjs'

const root = resolve(import.meta.dirname, '..')

for (const entry of releasePackages) {
  const manifest = JSON.parse(await readFile(resolve(root, 'packages', entry.folder, 'package.json'), 'utf8'))
  const published = isPublished(entry.name, manifest.version)
  process.stdout.write(`${entry.output}=${published}\n`)
  process.stderr.write(`${entry.name}@${manifest.version}: ${published ? 'already published' : 'not published'}\n`)
}
