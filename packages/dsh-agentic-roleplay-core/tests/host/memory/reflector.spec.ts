import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { ReflectionJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'

type Task = { prompt: string; result: unknown; beforeSubmit?: (value: unknown) => string | undefined }
let answer: (task: Task) => unknown

vi.mock('../../../src/host/agents/child.ts', () => ({
  runChild: async (task: Task) => {
    const value = answer(task)
    const refusal = task.beforeSubmit?.(value)
    if (refusal !== undefined) throw new Error(refusal)
    return value
  },
  childModel: () => ({}),
  childSampling: () => ({}),
  childTrace: () => undefined,
}))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: () => 'persona' }))

const { memoryReflector } = await import('../../../src/host/memory/reflection.ts')

let session: SessionStore
beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const base = { aliases: [], kind: 'person' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, tier: 'principal' as const, role: 'npc' as const, control: 'agent' as const }
  for (const [sourceId, name] of [['clara', 'Clara'], ['eleanor', 'Eleanor']] as const) {
    const { id } = session.characters.add({ ...base, sourceId, name })
    session.characterStates.create(id, { publicState: '', innerState: '', activity: 'idle' })
  }
  const happen = (turn: number, text: string, who: string): void => {
    session.edit({ turn, events: [{ turn, round: 1, text, importance: 2, tags: [], involves: [], perceivedBy: [{ character: who, mode: 'witnessed' as const, content: text, gist: text }] }] }, { seal: true })
  }
  happen(1, 'The ridge path is washed out', 'clara')
  session.edit({ turn: 2, beliefs: [{ character: 'clara', kind: 'belief', text: 'Harlan took the boat along the ridge path.', importance: 3 }] })
  happen(3, 'The boat is tied at the dock with the ridge path closed', 'clara')
  happen(3, 'Eleanor asks for the keys', 'eleanor')
  happen(4, 'Eleanor waits', 'eleanor')
  happen(5, 'Eleanor leaves', 'eleanor')
  happen(6, 'Eleanor returns', 'eleanor')
})
afterEach(() => { session.close() })

const dockOf = (): number => session.events.perceivedBy(session.characters.findByName('Clara')[0]!.id).find(entry => entry.event.turn === 3)!.perception.id

const run = async () => {
  const store = { story: session, settings: () => ({ ...DEFAULT_SETTINGS, reflection: { ...DEFAULT_SETTINGS.reflection, minNew: 1 } }), time: () => ({ now: 0, zone: 'UTC' }), cast: () => [], recordActivity: () => undefined } as unknown as TurnStore
  const reflector = memoryReflector({ agentOf: () => ({}) as never })
  const job = { chat: 'c', turn: 7, reason: 'manual', store } as unknown as ReflectionJob
  return await reflector.reflect(job, new AbortController().signal)
}

describe('the reflector', () => {
  it('doubts a belief its check finds contradicted, in place of what the pass would do to it', async () => {
    answer = (task) => {
      if (task.prompt.includes('A belief held by')) return { reason: 'a closed path rules out the ridge', things: [dockOf()], verdict: 'contradicted' }
      if (task.prompt.includes('Character: Eleanor')) return { add: [], revise: [], drop: [] }
      return { add: [], revise: [], drop: [{ id: 1, perceptions: [dockOf()] }] }
    }
    const { characters } = await run()
    expect(characters.map(entry => entry.name).sort()).toEqual(['Clara', 'Eleanor'])
    const belief = session.memories.list(session.characters.findByName('Clara')[0]!.id)[0]!
    expect(belief.confidence).toBe('doubtful')
    expect(session.memories.evidenceOf(belief.id).map(entry => entry.relation)).toEqual(['contradicts'])
  })

  it('mends what is only mechanically wrong instead of failing the pass', async () => {
    answer = (task) => (task.prompt.includes('A belief held by')
      ? { reason: 'they agree', things: [], verdict: 'consistent' }
      : { add: [{ kind: 'belief', text: 'Eleanor wants the keys.', importance: 3, confidence: 'sure', perceptions: [3, 4, 9999] }], revise: [{ id: 404, importance: 2 }], drop: [] })
    const { characters } = await run()
    expect(characters).toHaveLength(2)
  })

  it('goes on with the others when one cannot be sorted, tries it again next time, and says so', async () => {
    answer = (task) => {
      if (task.prompt.includes('A belief held by')) return { reason: 'they agree', things: [], verdict: 'consistent' }
      if (task.prompt.includes('Character: Clara')) throw new Error('the model did not stop')
      return { add: [], revise: [], drop: [] }
    }
    const { characters } = await run()
    expect(characters.map(entry => entry.name)).toEqual(['Eleanor'])
    expect(JSON.stringify(session.metadata.getValue('reflection.error'))).toContain('Clara could not be sorted this time')
    expect(session.metadata.getValue('reflection.cursor')).not.toHaveProperty('clara')
  })

  it('tries a character again with the older half of what it took in when the first try fails, and reaches only that far', async () => {
    for (let turn = 7; turn <= 16; turn += 1) session.edit({ turn, events: [{ turn, round: 1, text: `Clara sees thing ${turn}`, importance: 2, tags: [], involves: [], perceivedBy: [{ character: 'clara', mode: 'witnessed' as const, content: `thing ${turn}`, gist: `thing ${turn}` }] }] }, { seal: true })
    const sizes: number[] = []
    answer = (task) => {
      if (task.prompt.includes('A belief held by')) return { reason: 'they agree', things: [], verdict: 'consistent' }
      if (task.prompt.includes('Character: Clara')) {
        sizes.push(task.prompt.split('\n').filter(line => line.startsWith('- p')).length)
        if (sizes.length === 1) throw new Error('the model did not stop')
      }
      return { add: [], revise: [], drop: [] }
    }
    const { characters } = await run()
    expect(characters.map(entry => entry.name)).toContain('Clara')
    expect(sizes[1]).toBeLessThan(sizes[0]!)
    const cursor = session.metadata.getValue('reflection.cursor') as Record<string, number>
    const newest = Math.max(...session.events.perceivedBy(session.characters.findByName('Clara')[0]!.id).map(entry => entry.perception.id))
    expect(cursor['clara']).toBeLessThan(newest)
  })

  it('fails when nobody could be sorted', async () => {
    answer = () => { throw new Error('the model did not answer') }
    await expect(run()).rejects.toThrow('the model did not answer')
  })
})
