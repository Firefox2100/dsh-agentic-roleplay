import { spawnSync } from 'node:child_process'

const registry = 'https://registry.npmjs.org/'

export function isPublished(name, version) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json', `--registry=${registry}`], {
    encoding: 'utf8',
  })

  if (result.status === 0) {
    const published = JSON.parse(result.stdout)
    const versions = Array.isArray(published) ? published : [published]
    return versions.includes(version)
  }

  const failure = `${result.stdout}\n${result.stderr}`
  if (failure.includes('E404')) return false
  throw new Error(`Could not query ${name}@${version}:\n${failure.trim()}`)
}
