import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_NARRATE_TOOL, createCheckNarrateTool } from '../../../src/host/orchestration/check-tool.ts'
import { defaultBoundaries } from '../../../src/host/orchestration/defaults.ts'
import { createTools } from '../../../src/host/orchestration/tools.ts'
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

  it('needs no preview of the scene first: nobody is asked to act on this path', async () => {
    const settings = store.settings()
    store.settings = () => ({ ...settings, preview: { enabled: true } })
    const done = await call({}) as unknown as { output: { segments: unknown[] } }
    expect(done.output.segments).toEqual([{ type: 'narration', text: 'The lock clicks open.' }])
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

describe('telling the game master about the quick path', () => {
  const judged = async (enabled: boolean) => {
    const settings = store.settings()
    if (enabled) store.settings = () => ({ ...settings, tools: { gameMaster: { roll_and_narrate: true } } })
    const judge = createTools({ engine, boundaries: defaultBoundaries, stores: chat => (chat === 'session-1' ? store : undefined), turnOf: () => 1, delivered: delivered as never }).find(tool => tool.name === 'judge_action')!
    engine.expectJudgement({ chat: 'session-1', turn: 1 })
    const value = await judge.execute({ rule_check: 'no rules listed', allowed: true, uncertain: true, reason: 'Arthur tries the lock' } as never, { agent: { session: { id: 'session-1' } } as never, signal: new AbortController().signal } as never)
    return (judge.output as { render: (args: unknown, value: unknown) => { text: string }[] }).render({}, value)[0]!.text
  }

  it('names roll_and_narrate in the judgement of an uncertain attempt only when the tool is switched on', async () => {
    const off = await judged(false)
    expect(off).toContain('roll for it now with roll_check')
    expect(off).not.toContain('roll_and_narrate')
    expect(off).toMatch(/dice are rolled\. Then call preview_scene/)
  })

  it('offers it as the way to settle a lone attempt when it is switched on', async () => {
    const on = await judged(true)
    expect(on).toContain('roll for it now with roll_check')
    expect(on).toContain('settle it in one step with roll_and_narrate')
    expect(on).toMatch(/ends the turn\. Otherwise call preview_scene/)
  })
})
