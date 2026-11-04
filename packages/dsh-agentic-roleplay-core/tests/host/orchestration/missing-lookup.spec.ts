import { describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { notingEmpty } from '../../../src/host/orchestration/character-runner.ts'
import type { TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import type { TurnTrace } from '../../../src/shared/trace.ts'

const lookup = (found: unknown[]) => defineTool({
  name: 'recall_my_lore', description: 'x', parameters: { about: { type: 'string', required: true, description: 'x' } },
  output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {} } }, render: () => [{ type: 'text', text: '' }] },
  isConcurrencySafe: () => true,
  execute: () => Promise.resolve(found as never),
})

function storeKeeping(kept: TurnTrace[]): TurnStore {
  return { recordTrace: (turn: number, patch: object, merge?: (current: TurnTrace) => object) => { kept.push({ turn, startedAt: 0, ...patch, ...merge?.(kept.at(-1) ?? { turn, startedAt: 0 }) }) } } as unknown as TurnStore
}

describe('a look-up that finds nothing', () => {
  it('is kept in the turn\'s trace, and a look-up that finds something is not', async () => {
    const kept: TurnTrace[] = []
    const empty = notingEmpty(lookup([]), storeKeeping(kept), 4, 'Mira')
    expect(await empty.execute({ about: ' The Old Lighthouse ' } as never, {} as never)).toEqual([])
    expect(kept.at(-1)?.missing).toEqual([{ character: 'Mira', tool: 'recall_my_lore', about: 'The Old Lighthouse' }])
    const found = notingEmpty(lookup([{}]), storeKeeping(kept), 4, 'Mira')
    await found.execute({ about: 'the quay' } as never, {} as never)
    expect(kept).toHaveLength(1)
  })
})
