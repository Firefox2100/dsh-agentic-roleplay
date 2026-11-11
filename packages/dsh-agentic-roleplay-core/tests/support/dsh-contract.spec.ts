import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as compaction from '@deepseek-ai/dsh-compaction-basic'
import * as tools from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { DSH_RELEASES } from '../../../../scripts/dsh-compat.mjs'
import { SCROLL_BODY } from '../../src/client/interface/conversation-body.ts'

/**
 * The bundle builds its children (characters, record keeper) below DSH's sub-agent API, from the
 * helpers DSH exports for sub-agent providers. This fails when DSH changes what they rely on,
 * so that an upgrade is a deliberate piece of work (see docs/dsh-api-usage.md) and not a surprise.
 */
const require = createRequire(import.meta.url)

/** Reads a declaration file out of an installed DSH package, so an upgrade fails here instead of at run time. */
const declaration = (name: string, file = join('lib', 'types', 'index.d.ts')): string =>
  readFileSync(join(dirname(require.resolve(`@deepseek-ai/${name}/package.json`)), file), 'utf8')

/** The packages whose behaviour the bundle builds on, all published together with the runtime. */
const DSH_PACKAGES = ['dsh-subagent', 'dsh-tools', 'dsh-agent', 'dsh-session', 'dsh-compaction-basic']

describe('the DSH this bundle is built against', () => {
  it('is a DSH release whose contracts this bundle was tested against', () => {
    const installed = DSH_PACKAGES.map(name => (require(`@deepseek-ai/${name}/package.json`) as { version: string }).version)
    expect(new Set(installed).size, `the installed DSH packages disagree: ${installed.join(', ')}`).toBe(1)
    expect(DSH_RELEASES, `@deepseek-ai/dsh-*@${installed[0]} is not a tested release: verify it, fix what it changed, then add it to DSH_RELEASES in scripts/dsh-compat.mjs`).toContain(installed[0])
  })

  it('still exports what a helper\'s result is checked with', () => {
    expect(typeof tools.validateJsonSchemaValue).toBe('function')
    expect(typeof tools.ToolArgsError).toBe('function')
  })

  it('still styles the conversation\'s scrolling body with a class the interface packs\' backdrop finds it by', () => {
    const client = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')), 'lib', 'client.js'), 'utf8')
    expect(client).toMatch(new RegExp(`\\.[A-Za-z0-9]+${SCROLL_BODY}\\{`))
  })
})

/**
 * The version-sensitive uses listed in docs/docs/specifications/dsh-api-contract.md. Each one is read
 * out of the installed declarations (or the runtime module) so that an upgrade which moves it fails
 * here, naming the thing that moved, instead of failing somewhere inside a turn.
 */
describe('the DSH interfaces this bundle is registered against', () => {
  it('still declares the sub-agent activation that starts each character and the record keeper', () => {
    expect(declaration('dsh-subagent'), 'ctx.subagents.startActivation() is what host/agents/child.ts starts children with').toMatch(/startActivation\(\s*spec:/)
  })

  it('still declares the token meter the compaction path reads', () => {
    expect(declaration('dsh-token-meter'), 'host/compaction/ reads ctx.tokenMeter').toMatch(/\btokenMeter:\s*TokenMeter\b/)
  })

  it('still lets a session surface report the nodes it is made of', () => {
    expect(declaration('dsh-session', join('lib', 'types', 'surface.d.ts')), 'host/compaction/ reads session.surface.nodes').toMatch(/get nodes\(\):\s*readonly SessionSeq\[\]/)
  })

  it('still exports the compaction engine the story runs on', () => {
    expect(typeof compaction.BasicCompactionEngine, 'host/compaction/ constructs BasicCompactionEngine').toBe('function')
  })

  it('still takes its slot prop types from the store package this bundle keeps for types alone', () => {
    expect(
      declaration('dsh-client-ui-slots'),
      'the devDependency on @deepseek-ai/dsh-client-store in packages/dsh-agentic-roleplay-core/package.json exists only for this import; when it is gone the dependency is dead',
    ).toContain("from '@deepseek-ai/dsh-client-store'")
  })
})
