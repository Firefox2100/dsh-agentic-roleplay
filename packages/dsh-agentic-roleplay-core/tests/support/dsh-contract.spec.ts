import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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
