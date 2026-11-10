import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import { AutonomyTicker } from '../../../src/host/autonomy/ticker.ts'

const on = { ...DEFAULT_SETTINGS, autonomy: { ...DEFAULT_SETTINGS.autonomy, enabled: true }, clock: { ...DEFAULT_SETTINGS.clock, mode: 'real' as const } }

function ticker(settings: Record<string, typeof on>, failing: string[] = []) {
  const log = { ensured: [] as string[], ticked: [] as string[], problems: [] as string[] }
  const sessions = [{ id: 'a', name: 'A', archived: false }, { id: 'b', name: 'B', archived: false }, { id: 'c', name: 'C', archived: true }, { id: 'd', name: 'D', archived: false }]
  const made = new AutonomyTicker({
    sessions: () => sessions,
    settings: (id) => { if (id === 'd') throw new Error('unreadable'); return settings[id] ?? DEFAULT_SETTINGS as never },
    ensure: (id) => { log.ensured.push(id); return failing.includes(id) ? Promise.reject(new Error('no chat')) : Promise.resolve() },
    tick: (chat) => { log.ticked.push(chat); return Promise.resolve({ outcome: 'quiet', moved: 0 }) },
    problem: (message) => { log.problems.push(message) },
  })
  return { made, log }
}

describe('looking at the stories that go on without their player', () => {
  it('touches only a story that switched it on and is on the real clock, and not one put away', async () => {
    const { made, log } = ticker({ a: on, b: { ...on, clock: { ...on.clock, mode: 'simulated' as never } }, c: on })
    expect(await made.run(new AbortController().signal)).toBe(1)
    expect(log.ensured).toEqual(['a'])
    expect(log.ticked).toEqual(['session-a'])
  })

  it('reports a story it cannot read or look at, and goes on to the next', async () => {
    const { made, log } = ticker({ a: on, b: on }, ['a'])
    expect(await made.run(new AbortController().signal)).toBe(1)
    expect(log.ticked).toEqual(['session-b'])
    expect(log.problems).toEqual([expect.stringContaining('"A" could not be looked at'), expect.stringContaining('settings of "D"')])
  })

  it('does not start a second look while one is running, and stops when aborted', async () => {
    const { made } = ticker({ a: on })
    const controller = new AbortController()
    const first = made.run(controller.signal)
    expect(await made.run(controller.signal)).toBe(0)
    await first
    controller.abort()
    expect(await made.run(controller.signal)).toBe(0)
  })
})
