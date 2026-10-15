import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as subagent from '@deepseek-ai/dsh-subagent'
import * as tools from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { SCROLL_BODY } from '../../src/client/interface/conversation-body.ts'

/**
 * The bundle builds its children (characters, record keeper) below DSH's sub-agent API, from the
 * helpers DSH exports for sub-agent providers. This fails when DSH changes what they rely on,
 * so that an upgrade is a deliberate piece of work (see docs/dsh-api-usage.md) and not a surprise.
 */
const SERIES = /^0\.2\./
const require = createRequire(import.meta.url)

describe('the DSH this bundle is built against', () => {
  it('is the 0.2 series (release candidates included), for every package whose internals the bundle uses', () => {
    for (const name of ['dsh-subagent', 'dsh-tools', 'dsh-agent', 'dsh-session', 'dsh-compaction-basic']) {
      const { version } = require(`@deepseek-ai/${name}/package.json`) as { version: string }
      expect(version, `@deepseek-ai/${name}`).toMatch(SERIES)
    }
  })

  it('still exports the helpers a child is composed from', () => {
    for (const name of ['applyChildComposition', 'captureDelegatedPolicyOverrides', 'appendDelegatedPolicyOverrides', 'childSessionMeta', 'resolveChildAgentOptions', 'resolveChildDepth']) {
      expect(typeof (subagent as Record<string, unknown>)[name], name).toBe('function')
    }
    expect(typeof tools.validateJsonSchemaValue).toBe('function')
    expect(typeof tools.ToolArgsError).toBe('function')
  })

  it('still styles the conversation\'s scrolling body with a class the interface packs\' backdrop finds it by', () => {
    const client = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')), 'lib', 'client.js'), 'utf8')
    expect(client).toMatch(new RegExp(`\\.[A-Za-z0-9]+${SCROLL_BODY}\\{`))
  })
})
