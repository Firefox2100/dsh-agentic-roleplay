// What a scenario can do and look at: play turns into a running DSH, read the story's database (read-only), the chat log, and the helpers' record.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const starters = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'dsh-agentic-roleplay-core', 'starter-worlds')

/** What a player reads when the story opens, for a starter world. */
function openingOf(folder) {
  try {
    const text = JSON.parse(readFileSync(join(starters, folder, 'world.json'), 'utf8')).opening_message
    return typeof text === 'string' ? text : ''
  } catch { return '' }
}

export class Dsh {
  constructor(url, cookie) { this.base = new URL(url).origin; this.cookie = cookie }

  static async connect(url) {
    const login = await fetch(url, { redirect: 'manual' })
    const cookie = (login.headers.getSetCookie?.() ?? []).map(entry => entry.split(';')[0]).join('; ')
    if (cookie === '') throw new Error('the DSH did not give a session cookie: is the token in the URL current?')
    return new Dsh(url, cookie)
  }

  async api(path, init = {}) {
    const response = await fetch(`${this.base}/roleplay-api${path}`, { ...init, headers: { ...init.headers, cookie: this.cookie, 'content-type': 'application/json' } })
    if (!response.ok && response.status !== 202 && response.status !== 204) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`)
    return response.status === 204 ? undefined : await response.json().catch(() => undefined)
  }

  /** The starter world in the person's worlds, added when it is not there yet. */
  async ensureWorld(folder) {
    const starter = (await this.api('/worlds/starter')).find(entry => entry.folder === folder)
    if (starter === undefined) throw new Error(`there is no starter world "${folder}"`)
    if (!starter.installed) await this.api('/worlds/starter', { method: 'POST', body: JSON.stringify({ folder }) })
    const found = (await this.api('/worlds')).worlds.find(world => world.name === starter.name)
    if (found === undefined) throw new Error(`the world "${starter.name}" is not among the worlds`)
    return found
  }

  async start({ world, player, name, settings, startingTime }) {
    const found = await this.ensureWorld(world)
    const started = await this.api('/sessions', { method: 'POST', body: JSON.stringify({ worldId: found.id, name, playerCharacterId: player, ...(settings === undefined ? {} : { settings }), ...(startingTime === undefined ? {} : { startingTime }) }) })
    const { directory } = await this.api('/sessions')
    const story = new Story(this, started.id, directory)
    story.world = found
    story.opening = openingOf(world)
    return story
  }
}

/** One running session. */
export class Story {
  constructor(dsh, id, directory) { this.dsh = dsh; this.id = id; this.directory = directory; this.turns = [] }

  get database() { return join(this.directory, this.id, 'session.sqlite') }

  /** Reads the story's database as it is now; a new connection each time so what was just written is seen. */
  query(sql, ...params) {
    const db = new DatabaseSync(this.database, { readOnly: true })
    try { return db.prepare(sql).all(...params) } finally { db.close() }
  }

  one(sql, ...params) { return this.query(sql, ...params)[0] }

  async turnCount() { return (await this.dsh.api('/sessions')).sessions.find(session => session.id === this.id)?.turns ?? 0 }

  async settingsPayload() { return await this.dsh.api(`/sessions/settings?id=${this.id}`) }

  async setSettings(patch) {
    const { settings } = await this.settingsPayload()
    await this.dsh.api(`/sessions/settings?id=${this.id}`, { method: 'PUT', body: JSON.stringify(merge(settings, patch)) })
  }

  /** Sends a message and waits for the turn to be delivered, then for the records of it to be written. Returns what was measured. */
  async say(text, { turnLimitMs = 25 * 60_000, settleLimitMs = 10 * 60_000 } = {}) {
    const before = await this.turnCount()
    const ended = this.turnEnds()
    const sent = Date.now()
    await this.dsh.api('/sessions/message', { method: 'POST', body: JSON.stringify({ id: this.id, text }) })
    let gaveUp
    while (await this.turnCount() === before) {
      if (Date.now() - sent > turnLimitMs) throw new Error(`no turn was delivered within ${turnLimitMs / 60_000} minutes`)
      await sleep(2000)
      const over = this.turnEnds()
      if (over.count > ended.count) {
        gaveUp ??= Date.now()
        if (Date.now() - gaveUp > 15_000 && await this.turnCount() === before) throw new Error(`the turn ended without delivering anything (${over.reason})`)
      }
    }
    const delivered = Date.now() - sent
    await this.settle(settleLimitMs)
    const turn = { number: before + 1, text, deliveredMs: delivered, settledMs: Date.now() - sent }
    this.turns.push(turn)
    return turn
  }

  /**
   * Waits until the background work of the turn (suggestions, off-stage rounds, consolidation) has gone quiet: no helper has finished for a while.
   * When the scenario checks the records (`records: true`, which also makes the keeper run after every round), it waits for the keeper too.
   */
  async settle(limitMs, quietMs = 20_000) {
    const began = Date.now()
    let count = (await this.activity()).length
    let since = Date.now()
    while (Date.now() - began < limitMs) {
      await sleep(3000)
      const now = (await this.activity()).length
      if (now !== count) { count = now; since = Date.now() }
      const writing = this.waitForRecords ? (await this.settingsPayload()).pendingRecords > 0 : false
      if (!writing && Date.now() - since >= quietMs) return true
    }
    return false
  }

  async activity() { return (await this.settingsPayload()).activity }

  /** The turns played so far, with what was delivered for each. */
  async timeline() { return await this.dsh.api(`/sessions/timeline?id=${this.id}`) }

  /** How many turns the chat's log says have ended, and why the latest did; nothing is known without the log (or `zstd`). */
  turnEnds(sessionsRoot = this.sessionsRoot ?? join(homedir(), '.dsh', 'sessions')) {
    try {
      const file = chatLogFile(this.id, sessionsRoot)
      if (file === undefined) return { count: 0, reason: '' }
      const ends = execFileSync('zstd', ['-dc', file], { maxBuffer: 1 << 30 }).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.type === 'turn/end')
      return { count: ends.length, reason: ends.at(-1)?.data?.reason?.kind ?? '' }
    } catch { return { count: 0, reason: '' } }
  }

  /** The tool calls the game master made in the latest `turns` turns, in order: `{ name, args }`. */
  chatCalls(turns = 1, sessionsRoot = this.sessionsRoot ?? join(homedir(), '.dsh', 'sessions')) {
    const file = chatLogFile(this.id, sessionsRoot)
    if (file === undefined) throw new Error(`no chat log for ${this.id} under ${sessionsRoot}`)
    const rows = execFileSync('zstd', ['-dc', file], { maxBuffer: 1 << 30 }).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    const starts = rows.flatMap((row, index) => (row.type === 'turn/start' ? [index] : []))
    const from = starts.at(-turns) ?? 0
    const results = new Map(rows.slice(from).filter(row => row.type === 'tool/result').map(row => [row.data.callId ?? row.data.id, row]))
    return rows.slice(from).filter(row => row.type === 'tool/call').map(row => ({ name: row.data.name, args: parsed(row.data.args ?? row.data.input ?? row.data.arguments), result: results.get(row.data.callId ?? row.data.id) }))
  }

  async delete() { await this.dsh.api(`/sessions/item?id=${this.id}`, { method: 'DELETE' }) }
}

/** The log keeps a call's arguments as JSON text. */
function parsed(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

function chatLogFile(id, root) {
  for (const folder of readdirSync(root)) {
    const file = join(root, folder, `session-${id}`, 'session.v4.jsonl.zstd')
    if (existsSync(file)) return file
  }
  return undefined
}

function merge(base, patch) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) out[key] = merge(base?.[key], value)
  return out
}
