import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_NARRATE_TOOL, createCheckNarrateTool } from '../../../src/host/orchestration/check-tool.ts'
import { defaultBoundaries } from '../../../src/host/orchestration/defaults.ts'
import { TurnEngine } from '../../../src/host/orchestration/turn-engine.ts'
import { OPTIONAL_TOOLS } from '../../../src/shared/tools.ts'
import { alice, arthur, fakeStore, type FakeStore } from './fixtures.ts'

const branch = (summary: string, narration: string) => ({ summary, narration })
const luck = { key: 'luck', name: 'Luck', use: 'When chance decides.', dice: '1d20', compare: 'over' as const, bands: [{ min: 0, label: 'success', result: 'succeeded' as const }, { max: -1, label: 'failure', result: 'failed' as const }] }

let store: FakeStore
let engine: TurnEngine
let delivered: ReturnType<typeof vi.fn>
let concluded: ReturnType<typeof vi.fn>

const call = (args: Record<string, unknown>) => {
  const tool = createCheckNarrateTool({ engine, boundaries: defaultBoundaries, stores: chat => (chat === 'session-1' ? store : undefined), turnOf: () => 1, delivered: delivered as never })
  return tool.execute({ check: 'luck', character: 'arthur', reason: 'Arthur tries the lock', target: 1, on_success: branch('The lock gives.', 'The lock clicks open.'), on_failure: branch('The lock holds.', 'The lock will not move.'), ...args } as never, { agent: { session: { id: 'session-1' } }, signal: new AbortController().signal, concludeTurn: concluded } as never)
}

beforeEach(() => {
  store = fakeStore([arthur, alice])
  store.story.characters.add({ sourceId: 'arthur', name: 'Arthur', aliases: [], kind: 'person', tier: 'principal', role: 'playable', control: 'player', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  store.story.dice.define(luck)
  engine = new TurnEngine(defaultBoundaries, chat => (chat === 'session-1' ? store : undefined))
  delivered = vi.fn(() => 'node-1')
  concluded = vi.fn()
})

describe('rolling and narrating in one call', () => {
  it('is an optional tool of the game master, off unless switched on', () => {
    expect(OPTIONAL_TOOLS).toContainEqual({ id: CHECK_NARRATE_TOOL, agent: 'gameMaster', default: false })
  })

  it('delivers the branch the dice chose, records the player\'s round with the roll cited, and ends the turn', async () => {
    const won = await call({}) as unknown as { roll: string; output: { segments: unknown[]; timelineNode: string } }
    expect(won.output.segments).toEqual([{ type: 'narration', text: 'The lock clicks open.' }])
    expect(won.output.timelineNode).toBe('node-1')
    expect(concluded).toHaveBeenCalledOnce()
    expect(store.completed).toBe(1)
    expect(store.queue[0]?.entries.map(entry => [entry.character, entry.result, entry.summary])).toEqual([['arthur', 'succeeded', 'The lock gives.']])
    const rolls = store.story.dice.rolls({ turn: 1 })
    expect(rolls).toHaveLength(1)
    expect(rolls[0]).toMatchObject({ character: 'arthur', by: 'agent', readout: { result: 'succeeded' } })
  })

  it('delivers the other branch when the dice fall the other way', async () => {
    const lost = await call({ target: 99 }) as unknown as { output: { segments: unknown[] } }
    expect(lost.output.segments).toEqual([{ type: 'narration', text: 'The lock will not move.' }])
    expect(store.queue[0]?.entries[0]).toMatchObject({ result: 'failed', summary: 'The lock holds.' })
  })

  it('refuses before rolling when a branch the check can give is missing, an unknown check, or someone else', async () => {
    store.story.dice.define({ ...luck, key: 'edge', bands: [{ min: 5, label: 'win', result: 'succeeded' }, { min: 0, max: 4, label: 'mixed', result: 'partial' }, { max: -1, label: 'loss', result: 'failed' }] })
    await expect(call({ check: 'edge' })).rejects.toThrow(/give on_partial too; nothing was rolled/)
    await expect(call({ check: 'nope' })).rejects.toThrow(/no check "nope"/)
    await expect(call({ character: 'alice' })).rejects.toThrow(/only for the player's character \(arthur\)/)
    expect(store.story.dice.rolls({ turn: 1 })).toEqual([])
    expect(concluded).not.toHaveBeenCalled()
  })

  it('tells the game master the round is recorded when the narration is refused, so that it narrates instead of rolling again', async () => {
    await expect(call({ on_success: branch('The lock gives.', '') })).rejects.toThrow(/already recorded: do not roll again, call narrate/)
    expect(store.story.dice.rolls({ turn: 1 })).toHaveLength(1)
    expect(await engine.narrate({ chat: 'session-1', turn: 1 }, [{ type: 'narration', text: 'The lock clicks open.' }])).toMatchObject({ segments: [{ type: 'narration', text: 'The lock clicks open.' }] })
  })

  it('is not for a turn in which characters were already played', async () => {
    await call({})
    await expect(call({})).rejects.toThrow(/already played in this turn/)
  })
})
