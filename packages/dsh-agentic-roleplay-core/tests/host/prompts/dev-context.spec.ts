import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { silenceHarnessDevContext, silenceRuntimeContext } from '../../../src/host/prompts/dev-context.ts'

/** The order tables `SystemPrompt` publishes, as the harness itself numbers them. */
const SECTION_ORDERS: Record<string, number> = { HARNESS_SOURCE: 10000, WEB_SURFACE: 10100 }
const CONTEXT_ORDERS: Record<string, number> = { WORKING_DIRECTORY: 100, HARNESS_SOURCE: 200, WEB_SURFACE: 210 }

interface Contribution {
  kind: 'section' | 'context'
  name: string
  order: number
  text: unknown
  interpolate: unknown
}

/** A context that only records what would be registered, so the test needs no agent and no prompt. */
function recorder(): { ctx: Context; contributions: Contribution[] } {
  const contributions: Contribution[] = []
  const ctx = {
    effect: (run: () => unknown) => { run() },
    systemPrompt: {
      section: (entry: Omit<Contribution, 'kind'>) => {
        contributions.push({ kind: 'section', ...entry })
        return () => {}
      },
      context: (entry: Omit<Contribution, 'kind'>) => {
        contributions.push({ kind: 'context', ...entry })
        return () => {}
      },
      suppressRuntimeContext: () => { contributions.push({ kind: 'context', name: 'suppressed', order: 0, text: '', interpolate: false }); return () => {} },
      getSectionOrder: (name: string) => SECTION_ORDERS[name],
      getContextOrder: (name: string) => CONTEXT_ORDERS[name],
    },
  } as unknown as Context
  return { ctx, contributions }
}

describe('silencing the harness orientation text', () => {
  it('registers both of the dev-context names, as a section and as a context each', () => {
    const { ctx, contributions } = recorder()
    silenceHarnessDevContext(ctx)
    expect(contributions.map(entry => `${entry.kind}:${entry.name}`)).toEqual([
      'section:harness:source',
      'context:harness:source',
      'section:app:web-surface',
      'context:app:web-surface',
    ])
  })

  it('contributes no text, so the name shadows the profile prompt with nothing', () => {
    const { ctx, contributions } = recorder()
    silenceHarnessDevContext(ctx)
    for (const entry of contributions) expect(entry.text).toBe('')
  })

  it('keeps the order the harness gave those contributions, so the shadow lands in their place', () => {
    const { ctx, contributions } = recorder()
    silenceHarnessDevContext(ctx)
    expect(contributions.map(entry => entry.order)).toEqual([10000, 200, 10100, 210])
  })

  it('does not interpolate the empty text', () => {
    const { ctx, contributions } = recorder()
    silenceHarnessDevContext(ctx)
    for (const entry of contributions) expect(entry.interpolate).toBe(false)
  })
})

describe('silencing the runtime facts', () => {
  it('suppresses the optional facts and empties the required working directory', () => {
    const { ctx, contributions } = recorder()
    silenceRuntimeContext(ctx)
    expect(contributions.map(entry => entry.name)).toEqual(['suppressed', 'working-directory:current'])
    expect(contributions[1]).toMatchObject({ kind: 'context', order: 100, text: '', interpolate: false })
  })
})
