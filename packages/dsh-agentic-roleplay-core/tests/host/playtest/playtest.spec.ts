import { describe, expect, it } from 'vitest'
import type { Session } from '@dsh-agentic-roleplay/state'
import { Playtests, type PlaytestDeps } from '../../../src/host/playtest/playtest.ts'
import type { Note } from '../../../src/shared/notes.ts'
import type { TimelineView, TimelineTurn } from '../../../src/shared/timeline.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'

const output = { segments: [{ type: 'narration' as const, text: 'It happens.' }], repaired: false }
const turnOf = (n: number): TimelineTurn => ({ id: `n${n}`, turn: n, player: `p${n}`, output, restorable: true, alternatives: [`n${n}`] })

function fakes(options: { turnsFail?: boolean; suggestions?: boolean; place?: (played: number) => string } = {}) {
  let clock = 0
  let played = 0
  const sent: string[] = []
  const removed: string[] = []
  const characters = () => [{ character: 'ana', name: 'Ana', controlled_by: 'the player' as const, public_state: '', inner_state: '', activity: '', location: options.place?.(played) ?? 'quay', position: '', goals: [] }]
  const story = {
    metadata: { get: () => ({ turns: played }) },
    clock: { get: () => ({ mode: 'simulated', now: Date.UTC(2030, 0, 1) + played * 60_000 }) },
    records: () => ({ factions: [], faction_relationships: [], characters: characters(), events: [], beliefs: [], open_threads: [], items: [], variable_defs: [], variables: [], engagements: [], relationships: [], knowledge: [] }),
    locations: { list: () => [{ id: 1, sourceId: 'quay', name: 'Quay' }, { id: 2, sourceId: 'tower', name: 'Tower' }] },
    triggers: { list: () => [{ origin: 'world', name: 'Bell', fireCount: played > 1 ? 1 : 0, status: played > 1 ? 'fired' : 'dormant' }, { origin: 'world', name: 'Knock', fireCount: 0, status: 'dormant' }] },
  } as unknown as Session
  const deps: PlaytestDeps = {
    firstPlayer: () => Promise.resolve('ana'),
    start: (request) => { sent.push(`start ${JSON.stringify(request.settings)}`); return Promise.resolve({ id: 'sess', chatSessionId: 'chat', name: 'Playtest', worldId: request.worldId, worldName: 'Salt', characterCount: 2 }) },
    send: (_session, text) => { sent.push(text); if (!options.turnsFail) played += 1; return Promise.resolve() },
    timeline: () => ({ head: null, path: Array.from({ length: played }, (_, index) => turnOf(index + 1)), forward: [], canStart: true, withdrawn: [] }) as TimelineView,
    playing: () => false,
    notes: (): Note[] => (options.suggestions === false ? [] : [{ kind: 'suggestions', turn: played, lines: ['go up the tower', 'ring the bell'] }]),
    story: () => story,
    trace: () => [{ turn: 1, startedAt: 0, calls: [{ tool: 'judge_action', failed: false, note: 'ok' }, { tool: 'activate_characters', failed: true, note: 'Mira is not at the quay' }], missing: [{ character: 'Mira', tool: 'recall_my_lore', about: 'The Old Lighthouse' }] }, { turn: 2, startedAt: 0, missing: [{ character: 'Mira', tool: 'recall_my_lore', about: 'the old lighthouse' }, { character: 'Tam', tool: 'recall_my_memories', about: 'the storm' }], calls: [{ tool: 'narrate', failed: true, note: 'the output named a place the world does not have' }] }],
    halt: () => Promise.resolve(),
    remove: (id) => { removed.push(id); return Promise.resolve() },
    check: () => Promise.resolve([{ check: 'first-scene', severity: 'info', code: 'start-alone', where: 'characters/ana', message: 'alone' }]),
    now: () => clock,
    sleep: (ms) => { clock += ms * 30; return Promise.resolve() },
    turnTimeoutMs: () => 600_000,
  }
  return { deps, sent, removed }
}

describe('a bounded test play of a world', () => {
  it('plays the asked turns on the story\'s own suggestions, reports where it went, and removes the story', async () => {
    const { deps, sent, removed } = fakes({ place: played => (played >= 2 ? 'tower' : 'quay') })
    const tests = new Playtests(deps)
    tests.start({ worldId: 'w', turns: 3 })
    await tests.finished('w')
    const status = tests.status('w')!
    expect(status).toMatchObject({ state: 'done', played: 3 })
    expect(sent.slice(1)).toEqual(['I look around and take stock of where I am.', 'go up the tower', 'ring the bell'])
    expect(sent[0]).toContain('"images":{"mode":"off"}')
    expect(status.report).toMatchObject({
      world: 'Salt', asked: 3, played: 3,
      places: { visited: ['Quay', 'Tower'], unvisited: [] },
      triggers: { fired: ['Bell'], waiting: ['Knock'] },
      findings: [{ code: 'start-alone' }],
      missing: [{ turn: 1, character: 'Mira', tool: 'recall_my_lore', about: 'The Old Lighthouse' }, { turn: 2, character: 'Tam', tool: 'recall_my_memories', about: 'the storm' }],
      refused: [{ turn: 1, tool: 'activate_characters', note: 'Mira is not at the quay' }, { turn: 2, tool: 'narrate', note: 'the output named a place the world does not have' }],
    })
    expect(status.report!.changes).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'position', subject: 'Ana', a: 'quay', b: 'tower' })]))
    expect(removed).toEqual(['sess'])
  })

  it('takes a plain move when no suggestion comes, and says so', async () => {
    const { deps, sent } = fakes({ suggestions: false })
    const tests = new Playtests(deps)
    tests.start({ worldId: 'w', turns: 2 })
    await tests.finished('w')
    expect(sent[2]).toBe('I speak to the nearest person.')
    expect(tests.status('w')!.report!.problems).toEqual(['no suggestion came before turn 2, so the test player took a plain move'])
  })

  it('stops at a turn that never finishes, reports what it has and still removes the story', async () => {
    const { deps, removed } = fakes({ turnsFail: true })
    const tests = new Playtests(deps)
    tests.start({ worldId: 'w', turns: 3 })
    await tests.finished('w')
    expect(tests.status('w')).toMatchObject({ state: 'done', report: { played: 0, problems: ['turn 1 did not finish within 10 minutes'] } })
    expect(removed).toEqual(['sess'])
  })

  it('refuses turns out of range and a second run at the same time, and can be stopped', async () => {
    const { deps, removed } = fakes()
    const tests = new Playtests(deps)
    expect(() => tests.start({ worldId: 'w', turns: 0 })).toThrow(InvalidEditProblems)
    expect(() => tests.start({ worldId: 'w', turns: 11 })).toThrow(/1 to 10/)
    tests.start({ worldId: 'w', turns: 10 })
    expect(() => tests.start({ worldId: 'w', turns: 1 })).toThrow(/running/)
    expect(() => tests.start({ worldId: 'other', turns: 1 })).toThrow(/another test play/)
    await tests.stop('w')
    expect(tests.status('w')!.state).toBe('stopped')
    expect(removed).toEqual(['sess'])
  })

  it('says so when the world has no one to play', async () => {
    const { deps } = fakes()
    const tests = new Playtests({ ...deps, firstPlayer: () => Promise.resolve(undefined) })
    tests.start({ worldId: 'w', turns: 1 })
    await tests.finished('w')
    expect(tests.status('w')).toMatchObject({ state: 'failed', error: expect.stringContaining('no character a player can play') })
  })

  it('reports a story that could not even start', async () => {
    const { deps } = fakes()
    const tests = new Playtests({ ...deps, start: () => Promise.reject(new InvalidEditProblems(['the world has no playable character'])) })
    tests.start({ worldId: 'w', turns: 1 })
    await tests.finished('w')
    expect(tests.status('w')).toMatchObject({ state: 'failed', error: expect.stringContaining('no playable character') })
  })

  it('takes its plain moves in the language of the story', async () => {
    const { deps, sent } = fakes({ suggestions: false })
    const tests = new Playtests(deps)
    tests.start({ worldId: 'w', turns: 2, language: 'zh' })
    await tests.finished('w')
    expect(sent.slice(1)).toEqual(['我环顾四周，看看自己身处何地。', '我和离我最近的人说话。'])
  })
})
