/** Writes the DSH constraints of `scripts/dsh-compat.mjs` into every package manifest, so a new tested release is one edit there. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DSH_DEVELOPMENT, DSH_ENGINES } from './dsh-compat.mjs'

const root = resolve(import.meta.dirname, '..')
const section = (text, field, edit) => text.replace(new RegExp(`("${field}"\\s*:\\s*\\{)([^{}]*)(\\})`), (_match, open, body, close) => open + edit(body) + close)
const dshPackages = /("@deepseek-ai\/dsh-[a-z-]+")(\s*:\s*)"[^"]*"/g

for (const folder of await readdir(resolve(root, 'packages'))) {
  const file = resolve(root, 'packages', folder, 'package.json')
  const before = await readFile(file, 'utf8')
  let text = section(before, 'peerDependencies', body => body.replace(/("@deepseek-ai\/dsh")(\s*:\s*)"[^"]*"/, `$1$2"${DSH_ENGINES}"`))
  for (const field of ['dependencies', 'devDependencies']) text = section(text, field, body => body.replace(dshPackages, `$1$2"${DSH_DEVELOPMENT}"`))
  text = text.replace(/("engines"\s*:\s*\{[^{}]*)"dsh"\s*:\s*"[^"]*"/, `$1"dsh": "${DSH_ENGINES}"`)
  JSON.parse(text)
  if (text !== before) await writeFile(file, text)
}

// A peer dependency resolves to the lowest release of its range, so the workspace names the development release.
const workspaceFile = resolve(root, 'pnpm-workspace.yaml')
const workspace = await readFile(workspaceFile, 'utf8')
const override = `  '@deepseek-ai/dsh': ${DSH_DEVELOPMENT}`
const pinned = /^  '@deepseek-ai\/dsh': .*$/m.test(workspace) ? workspace.replace(/^  '@deepseek-ai\/dsh': .*$/m, override) : workspace.replace('overrides:\n', `overrides:\n${override}\n`)
if (pinned !== workspace) await writeFile(workspaceFile, pinned)
