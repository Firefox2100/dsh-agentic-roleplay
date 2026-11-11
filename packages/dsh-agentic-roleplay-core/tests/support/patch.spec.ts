import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AGENT_PRESET } from '../../src/host/agent/agent-sessions.ts'
import { AUTHORING_AGENT_PRESET } from '../../src/host/agent/authoring-sessions.ts'
import { DOCTOR_AGENT_PRESET } from '../../src/host/agent/doctor-sessions.ts'
import { LOREBOOK_AUTHORING_PRESET } from '../../src/host/agent/lorebook-authoring-sessions.ts'
import { PRESET_AUTHORING_PRESET } from '../../src/host/agent/preset-authoring-sessions.ts'
import { HELPER_PRESET } from '../../src/host/agents/child.ts'
import { ENTRY_ID } from '../../src/shared/ids.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = join(here, '..', '..', '..', 'dsh-agentic-roleplay')
// The patch ships with the repository, so its line endings follow the checkout; the rules below are about lines.
const patch = readFileSync(join(bundle, 'cordis.patch.yml'), 'utf8').replaceAll('\r\n', '\n')
const manifest = JSON.parse(readFileSync(join(bundle, '..', 'dsh-agentic-roleplay-core', 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
}

/** The entry a preset mounts, one per preset: the plugin that brings its own tools and instructions. */
const ENTRIES: Record<string, string> = {
  [AGENT_PRESET]: 'orchestration',
  [HELPER_PRESET]: 'helper',
  [AUTHORING_AGENT_PRESET]: 'authoring',
  [PRESET_AUTHORING_PRESET]: 'preset-authoring',
  [LOREBOOK_AUTHORING_PRESET]: 'lorebook-authoring',
  [DOCTOR_AGENT_PRESET]: 'doctor',
}

/** The `name` on the line after `- id: <id>`: that is how a row in this patch names the plugin it inserts. */
const row = (id: string): string | undefined => {
  const lines = patch.split('\n')
  const at = lines.findIndex((line) => line.trim() === `- id: ${id}`)
  return at < 0 ? undefined : /name: '([^']+)'/.exec(lines[at + 1] ?? '')?.[1]
}

describe('the bundle patch and the code it installs', () => {
  it('inserts the settings row the core package exports, under the id the settings form uses', () => {
    expect(row(ENTRY_ID)).toBe('@dsh-agentic-roleplay/core')
    expect(row('roleplay-state')).toBe('@dsh-agentic-roleplay/state')
  })

  it('runs every agent preset the code starts chats under', () => {
    for (const preset of Object.keys(ENTRIES)) {
      expect(patch, `agent preset ${preset} is missing from the bundle`).toMatch(
        new RegExp(String.raw`^\s+id: ${preset}$\n\s+name: `, 'm'),
      )
    }
    expect(patch.match(/name: '@deepseek-ai\/dsh-agent-preset'/g) ?? []).toHaveLength(Object.keys(ENTRIES).length)
  })

  it('mounts a sub-entry that the core package publishes, in every preset', () => {
    for (const [preset, entry] of Object.entries(ENTRIES)) {
      const name = `@dsh-agentic-roleplay/core/${entry}`
      expect(patch, `preset ${preset} mounts ${name}?`).toContain(`name: '${name}'`)
      expect(manifest.exports, `${name} is not in the package exports`).toHaveProperty(`./${entry}`)
    }
  })

  it('leaves the profile its own orientation text, and only raises the sub-agent ceiling', () => {
    expect(patch, 'disabling harness-dev-context would take it away from every session in the profile').not.toMatch(
      /harness-dev-context[\s\S]{0,80}disabled: true/,
    )
    expect(patch).toMatch(/^- id: subagent\n {2}config:\n {4}maxActiveSubagents: 32$/m)
  })
})
