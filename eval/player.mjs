// A model that plays the player's character, so that a run covers more turns than a script and goes where a script would not.
// It is bounded on every side: turns, tokens it may spend, wall time, the length of what it says, and it stops when it repeats itself or fails.

/** Limits no option may raise. */
export const HARD_LIMITS = { turns: 30, tokens: 200_000, minutes: 120 }
export const DEFAULT_LIMITS = { turns: 6, tokens: 30_000, minutes: 40 }

const MAX_ACTION = 300
const MAX_REPLY_TOKENS = 160
const MAX_READ = 1500
const REMEMBERED_ACTIONS = 5
const CALL_TIMEOUT_MS = 90_000

const SYSTEM = [
  'You play one character in an interactive story, the way a human player would.',
  'Each time, write ONLY what your character does or says next: one to three sentences, in the first person, plain text.',
  'Never describe what happens as a result, never speak for anyone else, never write commands that start with "/", and never mention being an AI or a game.',
  'Pursue your goal, but react to what you just read; do not repeat yourself.',
  'When your goal is reached or there is nothing left to try, answer with the single word DONE.',
].join(' ')

const clip = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}…` : text)
const normal = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** What the player reads of a delivered turn: the narration and the words spoken, as plain text. */
export function readable(output) {
  if (output === undefined || output === null) return ''
  return output.segments.map(segment => (segment.type === 'utterance' ? `${segment.name}: "${segment.text}"` : segment.text)).join('\n')
}

/** What the model wrote, as one action; `DONE` for the end; undefined when it is not an action. */
export function actionFrom(reply) {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["'`*_\s]+|["'`*_\s]+$/g, '').replace(/\s+/g, ' ')
  if (text === '') return undefined
  if (/^done\b[.!]?$/i.test(text)) return 'DONE'
  if (text.startsWith('/')) return undefined
  return clip(text, MAX_ACTION)
}

export function limitsFrom(wanted = {}) {
  const pick = (value, standard, hard) => Math.max(1, Math.min(hard, Number.isFinite(value) ? value : standard))
  return {
    turns: pick(wanted.turns, DEFAULT_LIMITS.turns, HARD_LIMITS.turns),
    tokens: pick(wanted.tokens, DEFAULT_LIMITS.tokens, HARD_LIMITS.tokens),
    ms: pick(wanted.minutes, DEFAULT_LIMITS.minutes, HARD_LIMITS.minutes) * 60_000,
  }
}

export class AiPlayer {
  /** @param {{ url: string, model: string, key?: string, reasoning?: string, limits?: { turns?: number, tokens?: number, minutes?: number } }} options */
  constructor({ url, model, key, reasoning = 'none', limits }) {
    this.url = url.replace(/\/+$/, '')
    this.model = model
    this.key = key
    this.reasoning = reasoning
    this.limits = limitsFrom(limits)
  }

  async ask(messages) {
    const response = await fetch(`${this.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.key === undefined ? {} : { authorization: `Bearer ${this.key}` }) },
      body: JSON.stringify({ model: this.model, messages, max_tokens: MAX_REPLY_TOKENS, temperature: 0.8, stream: false, ...(this.reasoning === 'omit' ? {} : { reasoning_effort: this.reasoning }) }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`the player's model answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const body = await response.json()
    const text = body.choices?.[0]?.message?.content ?? ''
    const spent = body.usage?.total_tokens ?? Math.ceil((JSON.stringify(messages).length + text.length) / 3)
    return { text, spent }
  }

  /**
   * Plays up to the limits and says why it stopped: `done` (the player said so), `turns`, `tokens`, `time`, `stuck` (it repeated itself or turns came out empty),
   * `invalid` (the model gave no action) or `failed` (a call or a turn failed, with the message).
   * @param {{ say(text: string, options?: object): Promise<{ deliveredMs: number }>, timeline(): Promise<{ path: { output?: object }[] }> }} story
   * @param {{ goal: string, name: string, about?: string, opening?: string, turnLimitMs?: number }} scene
   */
  async play(story, { goal, name, about = '', opening = '', turnLimitMs = 10 * 60_000 }) {
    const began = Date.now()
    const report = { stop: 'turns', turns: 0, tokens: 0, actions: [], ms: 0 }
    const recent = []
    const deliveries = []
    let read = opening
    let empty = 0
    const finish = (stop, error) => { report.stop = stop; if (error !== undefined) report.error = String(error).slice(0, 300); report.ms = Date.now() - began; return report }
    for (;;) {
      if (report.turns >= this.limits.turns) return finish('turns')
      if (report.tokens >= this.limits.tokens) return finish('tokens')
      const typical = deliveries.length === 0 ? 0 : [...deliveries].sort((a, b) => a - b)[Math.floor(deliveries.length / 2)]
      if (Date.now() - began + typical > this.limits.ms) return finish('time')
      const brief = [`Your character: ${name}.`, about === '' ? '' : `The story: ${clip(about, 600)}`, `Your goal: ${goal}`, recent.length === 0 ? '' : `What you did lately:\n${recent.map(action => `- ${action}`).join('\n')}`, read === '' ? 'The story has just begun.' : `What you just read${report.turns === 0 ? ' (the opening of the story)' : ''}:\n${clip(read, MAX_READ)}`].filter(part => part !== '').join('\n\n')
      let answer
      try { answer = await this.ask([{ role: 'system', content: SYSTEM }, { role: 'user', content: brief }]) } catch (error) { return finish('failed', error instanceof Error ? error.message : error) }
      report.tokens += answer.spent
      const action = actionFrom(answer.text)
      if (action === undefined) return finish('invalid', `no usable action in: ${clip(answer.text, 80)}`)
      if (action === 'DONE') return finish('done')
      if (recent.some(earlier => normal(earlier) === normal(action)) && report.turns > 0) return finish('stuck', `repeated: ${clip(action, 80)}`)
      let turn
      try { turn = await story.say(action, { turnLimitMs }) } catch (error) { return finish('failed', error instanceof Error ? error.message : error) }
      report.turns += 1
      report.actions.push(action)
      deliveries.push(turn.deliveredMs)
      recent.push(action)
      if (recent.length > REMEMBERED_ACTIONS) recent.shift()
      const path = (await story.timeline()).path
      read = readable(path.at(-1)?.output)
      empty = read === '' ? empty + 1 : 0
      if (empty >= 2) return finish('stuck', 'two turns in a row delivered nothing to read')
    }
  }
}
