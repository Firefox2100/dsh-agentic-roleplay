import { describe, expect, it, vi } from 'vitest'
import { Bridge, MAX_REQUESTS_PER_SECOND, clampHeight, parseFrameMessage, type BridgeEnv } from '../../../src/client/interface/bridge.ts'
import type { PlayerView } from '../../../src/shared/interface-pack.ts'

const view = (turn = 1, suggestions = ['Ask Clara.', 'Leave.']): PlayerView => ({ api: 1, revision: 'r', story: { name: 'S', turn }, map: { places: [], routes: [] }, carried: [], variables: [], suggestions })

function setup(actions: BridgeEnv['actions'] = ['say', 'fill', 'choose', 'open'], current: PlayerView | null = view()) {
  let clock = 0
  const state = { view: current ?? undefined, said: [] as string[], filled: [] as string[], opened: [] as string[] }
  const env: BridgeEnv = {
    actions,
    view: () => state.view,
    say: (text) => { state.said.push(text) },
    fill: (text) => { state.filled.push(text) },
    open: (surface) => { state.opened.push(surface) },
    storage: vi.fn(() => Promise.resolve('kept')),
    history: vi.fn((limit: number) => Promise.resolve([{ turn: limit, player: 'hi', segments: [{ type: 'narration' as const, text: 'Rain.' }] }])),
    theme: () => ({ scheme: 'dark', tokens: { '--dsw-alias-bg-base': '#000' } }),
    now: () => clock,
  }
  return { env, state, bridge: new Bridge(env), tick: (ms: number) => { clock += ms } }
}
const ask = (bridge: Bridge, method: string, params: Record<string, unknown> = {}) => bridge.answer({ type: 'request', id: 1, method, params })

describe('reading what a surface sends', () => {
  it('knows the protocol and nothing else', () => {
    expect(parseFrameMessage({ rp: 1, type: 'hello' })).toEqual({ type: 'hello' })
    expect(parseFrameMessage({ rp: 1, type: 'resize', height: 80 })).toEqual({ type: 'resize', height: 80 })
    expect(parseFrameMessage({ rp: 1, type: 'request', id: 3, method: 'say', params: { text: 'hi' } })).toEqual({ type: 'request', id: 3, method: 'say', params: { text: 'hi' } })
    for (const odd of [null, 'x', 4, {}, { rp: 2, type: 'hello' }, { rp: 1, type: 'resize', height: 'tall' }, { rp: 1, type: 'request', id: 'a', method: 'say' }, { rp: 1, type: 'other' }]) expect(parseFrameMessage(odd), JSON.stringify(odd)).toBeUndefined()
  })

  it('keeps a height within what a strip may take', () => {
    expect(clampHeight(2, 'hud')).toBe(24)
    expect(clampHeight(90.4, 'dock')).toBe(90)
    expect(clampHeight(5000, 'hud')).toBe(320)
    expect(clampHeight(5, 'opening')).toBe(120)
    expect(clampHeight(5000, 'opening')).toBe(640)
  })
})

describe('answering a surface', () => {
  it('gives the view it holds', async () => {
    const { bridge } = setup()
    expect(await ask(bridge, 'state')).toEqual({ ok: true, value: view() })
    expect(await ask(setup(['say'], null).bridge, 'state')).toEqual({ ok: false, error: 'the story has not been read yet' })
  })

  it('does only the actions the pack asked for', async () => {
    const { bridge, state } = setup(['fill'])
    expect(await ask(bridge, 'say', { text: 'hi' })).toEqual({ ok: false, error: 'the pack did not ask for "say" in its pack.json actions' })
    expect(await ask(bridge, 'fill', { text: 'hello' })).toEqual({ ok: true, value: null })
    expect(state.said).toEqual([])
    expect(state.filled).toEqual(['hello'])
  })

  it('lets the pack speak once in a turn, and again when the story has moved or a while has passed', async () => {
    const { bridge, state, tick } = setup()
    expect((await ask(bridge, 'say', { text: 'one' })).ok).toBe(true)
    expect((await ask(bridge, 'say', { text: 'two' }))).toEqual({ ok: false, error: 'already said something this turn; wait for the story to answer' })
    state.view = view(2)
    expect((await ask(bridge, 'say', { text: 'three' })).ok).toBe(true)
    tick(31_000)
    expect((await ask(bridge, 'say', { text: 'four' })).ok).toBe(true)
    expect(state.said).toEqual(['one', 'three', 'four'])
  })

  it('takes a suggestion as the input and refuses one that is not there', async () => {
    const { bridge, state } = setup()
    expect((await ask(bridge, 'choose', { index: 1 })).ok).toBe(true)
    expect(state.filled).toEqual(['Leave.'])
    for (const index of [5, -1, 0.5, 'a']) expect((await ask(bridge, 'choose', { index })).ok, String(index)).toBe(false)
  })

  it('refuses empty or very long words and things that are not text', async () => {
    const { bridge } = setup()
    expect((await ask(bridge, 'fill', { text: '  ' })).ok).toBe(false)
    expect((await ask(bridge, 'fill', { text: 'x'.repeat(2001) })).ok).toBe(false)
    expect(await ask(bridge, 'fill', { text: 4 })).toEqual({ ok: false, error: 'text must be text' })
  })

  it('keeps small values for the pack and says what the theme is', async () => {
    const { bridge, env } = setup([])
    expect(await ask(bridge, 'storage.get', { key: 'seen' })).toEqual({ ok: true, value: 'kept' })
    await ask(bridge, 'storage.set', { key: 'seen', value: [1] })
    expect(env.storage).toHaveBeenLastCalledWith('set', 'seen', [1])
    expect(await ask(bridge, 'theme')).toEqual({ ok: true, value: { scheme: 'dark', tokens: { '--dsw-alias-bg-base': '#000' } } })
  })

  it('shows the pack\'s own tab or sidebar page when asked and allowed, and nothing else', async () => {
    const { bridge, state } = setup(['open'])
    expect((await ask(bridge, 'open', { surface: 'sidebar' })).ok).toBe(true)
    expect((await ask(bridge, 'open', { surface: 'tab' })).ok).toBe(true)
    expect(state.opened).toEqual(['sidebar', 'tab'])
    expect(await ask(bridge, 'open', { surface: 'settings' })).toEqual({ ok: false, error: 'surface must be "tab" or "sidebar"' })
    expect(await ask(setup(['say']).bridge, 'open', { surface: 'tab' })).toEqual({ ok: false, error: 'the pack did not ask for "open" in its pack.json actions' })
  })

  it('gives the story so far, as many turns as asked within the limit', async () => {
    const { bridge, env } = setup([])
    expect(await ask(bridge, 'history')).toEqual({ ok: true, value: [expect.objectContaining({ turn: 20 })] })
    expect(await ask(bridge, 'history', { limit: 5 })).toEqual({ ok: true, value: [expect.objectContaining({ turn: 5 })] })
    await ask(bridge, 'history', { limit: 5000 })
    expect(env.history).toHaveBeenLastCalledWith(100)
    await ask(bridge, 'history', { limit: 'all' })
    expect(env.history).toHaveBeenLastCalledWith(20)
  })

  it('has nothing but what it lists, and stops a flood', async () => {
    const { bridge } = setup()
    expect(await ask(bridge, 'fetch')).toEqual({ ok: false, error: 'there is no rp.fetch' })
    const answers = await Promise.all(Array.from({ length: MAX_REQUESTS_PER_SECOND + 5 }, () => ask(bridge, 'state')))
    expect(answers.filter(answer => !answer.ok).length).toBeGreaterThan(0)
  })
})
