import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packages = path.join(root, 'packages')
const output = path.join(root, 'coverage', 'lcov.info')
const reports = []

for (const name of await readdir(packages)) {
  const packageRoot = path.join(packages, name)
  const report = path.join(packageRoot, 'coverage', 'lcov.info')

  try {
    const content = await readFile(report, 'utf8')
    reports.push(content.replace(/^SF:(.+)$/gm, (_, source) => {
      // LCOV paths are slash-separated on every platform: Sonar and the other readers take them as written, and a
      // Windows checkout would otherwise report `packages\alpha\src\alpha.ts` and match no file.
      const relative = path.relative(root, path.resolve(packageRoot, source))
      return `SF:${relative.split(path.sep).join('/')}`
    }))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

if (!reports.length) throw new Error('No LCOV reports were found.')

await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, reports.join('\n'))
