import { PACK_API, PACK_LIMITS, STRIP_HEIGHTS, type HistoryTurn, type PackAction, type PlayerView, type StripSurface } from '../../shared/interface-pack.ts'

/** What a surface sends to the page. */
export type FrameMessage =
  | { type: 'hello' }
  | { type: 'resize'; height: number }
  | { type: 'request'; id: number; method: string; params: Record<string, unknown> }

/** The answer to a request. */
export type Answer = { ok: true; value: unknown } | { ok: false; error: string }

export interface ThemeData {
  scheme: 'light' | 'dark'
  tokens: Record<string, string>
}

/** What the page lets a surface reach: nothing but these. */
export interface BridgeEnv {
  actions: readonly PackAction[]
  view(): PlayerView | undefined
  say(text: string): void | Promise<void>
  fill(text: string): void | Promise<void>
  storage(op: 'get' | 'set' | 'remove', key: string, value?: unknown): Promise<unknown>
  history(limit: number): Promise<HistoryTurn[]>
  theme(): ThemeData
  now(): number
}

/** Most requests a surface may make in a second. */
export const MAX_REQUESTS_PER_SECOND = 20
/** The longest words a surface may send as the player. */
export const MAX_WORDS = 2000
/** How long a surface waits before it may speak again when the turn does not move. */
const SAY_AGAIN_AFTER_MS = 30_000

/** Reads what came through `postMessage`; anything that is not the protocol is nothing. */
export function parseFrameMessage(data: unknown): FrameMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const message = data as Record<string, unknown>
  if (message['rp'] !== PACK_API) return undefined
  if (message['type'] === 'hello') return { type: 'hello' }
  if (message['type'] === 'resize') return typeof message['height'] === 'number' && Number.isFinite(message['height']) ? { type: 'resize', height: message['height'] } : undefined
  if (message['type'] === 'request' && typeof message['id'] === 'number' && typeof message['method'] === 'string') {
    const params = message['params']
    return { type: 'request', id: message['id'], method: message['method'], params: typeof params === 'object' && params !== null && !Array.isArray(params) ? params as Record<string, unknown> : {} }
  }
  return undefined
}

/** The height a surface may ask for, as the interface allows it for that strip. */
export function clampHeight(height: number, surface: StripSurface): number {
  const { min, max } = STRIP_HEIGHTS[surface]
  return Math.min(max, Math.max(min, Math.round(height)))
}

const text = (params: Record<string, unknown>, name: string): string => {
  const value = params[name]
  if (typeof value !== 'string') throw new Error(`${name} must be text`)
  return value
}

/** Answers a surface's requests: what the pack was allowed to ask in its manifest, within limits, nothing else. */
export class Bridge {
  private readonly stamps: number[] = []
  private spoke: { turn: number; at: number } | undefined

  constructor(private readonly env: BridgeEnv) {}

  async answer(message: Extract<FrameMessage, { type: 'request' }>): Promise<Answer> {
    try {
      return { ok: true, value: await this.run(message.method, message.params) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private allowed(action: PackAction): void {
    if (!this.env.actions.includes(action)) throw new Error(`the pack did not ask for "${action}" in its pack.json actions`)
  }

  private words(params: Record<string, unknown>): string {
    const words = text(params, 'text').trim()
    if (words === '') throw new Error('there are no words')
    if (words.length > MAX_WORDS) throw new Error(`words are at most ${MAX_WORDS} characters`)
    return words
  }

  private async run(method: string, params: Record<string, unknown>): Promise<unknown> {
    const now = this.env.now()
    while (this.stamps.length > 0 && now - (this.stamps[0] as number) >= 1000) this.stamps.shift()
    if (this.stamps.length >= MAX_REQUESTS_PER_SECOND) throw new Error('too many requests; at most 20 a second')
    this.stamps.push(now)
    const view = this.env.view()
    switch (method) {
      case 'state':
        if (view === undefined) throw new Error('the story has not been read yet')
        return view
      case 'say': {
        this.allowed('say')
        const turn = view?.story.turn ?? 0
        if (this.spoke !== undefined && this.spoke.turn === turn && now - this.spoke.at < SAY_AGAIN_AFTER_MS) throw new Error('already said something this turn; wait for the story to answer')
        const words = this.words(params)
        this.spoke = { turn, at: now }
        await this.env.say(words)
        return null
      }
      case 'fill':
        this.allowed('fill')
        await this.env.fill(this.words(params))
        return null
      case 'choose': {
        this.allowed('choose')
        const index = params['index']
        const chosen = typeof index === 'number' && Number.isInteger(index) ? view?.suggestions[index] : undefined
        if (chosen === undefined) throw new Error('there is no such suggestion')
        await this.env.fill(chosen)
        return null
      }
      case 'storage.get': return await this.env.storage('get', text(params, 'key'))
      case 'storage.set': await this.env.storage('set', text(params, 'key'), params['value']); return null
      case 'storage.remove': await this.env.storage('remove', text(params, 'key')); return null
      case 'history': {
        const asked = params['limit']
        const limit = typeof asked === 'number' && Number.isInteger(asked) && asked >= 1 ? Math.min(asked, PACK_LIMITS.history.max) : PACK_LIMITS.history.fallback
        return await this.env.history(limit)
      }
      case 'theme': return this.env.theme()
      default: throw new Error(`there is no rp.${method}`)
    }
  }
}
